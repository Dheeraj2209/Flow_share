import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { broadcast } from "@/lib/sse";
import { corsHeaders, preflight } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _: NextRequest,
  { params }: { params: { id: string } },
) {
  const db = getDb();
  const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [
    Number(params.id),
  ]);
  if (!task)
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  return Response.json({ task }, { headers: corsHeaders() });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const db = getDb();
  const id = Number(params.id);
  const existing = await db.get(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (!existing)
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  const body = await req.json().catch(() => ({}) as any);

  if (body.done_on) {
    const done_on = String(body.done_on);
    const done = body.done === false ? false : true;
    if (done) {
      await db.run(
        `INSERT OR IGNORE INTO task_done_dates (task_id, date) VALUES (?, ?)`,
        [id, done_on],
      );
    } else {
      await db.run(
        `DELETE FROM task_done_dates WHERE task_id = ? AND date = ?`,
        [id, done_on],
      );
    }
    broadcast("task_updated", { task_id: id, done_on, done });
    return Response.json(
      { ok: true, task_id: id, done_on, done },
      { headers: corsHeaders() },
    );
  }
  const fields: string[] = [];
  const values: any[] = [];
  const updatable = [
    "title",
    "description",
    "person_id",
    "status",
    "due_date",
    "due_time",
    "bucket_type",
    "bucket_date",
    "recurrence",
    "interval",
    "byweekday",
    "until",
    "sort",
    "color",
    "priority",
  ] as const;
  for (const key of updatable) {
    if (key in body) {
      if (key === "interval") {
        fields.push(`${key} = ?`);
        values.push(Math.max(1, Number(body[key])));
      } else if (key === "byweekday") {
        fields.push(`${key} = ?`);
        values.push(body[key] ? JSON.stringify(body[key]) : null);
      } else if (key === "person_id") {
        fields.push(`${key} = ?`);
        values.push(body[key] != null ? Number(body[key]) : null);
      } else if (key === "sort") {
        fields.push(`${key} = ?`);
        values.push(Number(body[key]) | 0);
      } else if (key === "priority") {
        fields.push(`${key} = ?`);
        values.push(Math.max(0, Math.min(3, Number(body[key]))));
      } else {
        fields.push(`${key} = ?`);
        values.push(body[key] ?? null);
      }
    }
  }
  if (!fields.length) return new Response("No changes", { status: 400 });
  const sql = `UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`;
  values.push(id);
  await db.run(sql, values);
  const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [id]);

  // Push updates to external provider if linked
  try {
    const t: any = task;
    if (t?.source_id) {
      const src = (await db.get(`SELECT * FROM external_sources WHERE id = ?`, [
        t.source_id,
      ])) as any | undefined;
      if (src?.access_token) {
        const headers: HeadersInit = {
          Authorization: `Bearer ${src.access_token}`,
        };
        if (src.provider === "ms_graph_todo") {
          // Microsoft To Do
          const [listId, taskId] =
            t.external_id && String(t.external_id).includes(":")
              ? String(t.external_id).split(":", 2)
              : [null, t.external_id];
          // if listId unknown, pick first list
          let useListId = listId as string | null;
          if (!useListId) {
            const lists = await fetch(
              "https://graph.microsoft.com/v1.0/me/todo/lists",
              { headers },
            )
              .then((r) => r.json())
              .catch(() => ({ value: [] as any[] }));
            useListId = lists?.value?.[0]?.id || null;
          }
          if (useListId && taskId) {
            const body: any = { title: t.title };
            if (t.due_date) {
              const dt = t.due_time
                ? `${t.due_date}T${t.due_time}:00`
                : `${t.due_date}T00:00:00`;
              body.dueDateTime = { dateTime: dt, timeZone: "UTC" };
            } else {
              body.dueDateTime = null;
            }
            await fetch(
              `https://graph.microsoft.com/v1.0/me/todo/lists/${useListId}/tasks/${taskId}`,
              {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(body),
              },
            ).catch(() => {});
          }
        } else if (src.provider === "ms_graph_calendar") {
          const body: any = { subject: t.title };
          if (t.due_date) {
            const dt = t.due_time
              ? `${t.due_date}T${t.due_time}:00`
              : `${t.due_date}T00:00:00`;
            body.start = { dateTime: dt, timeZone: "UTC" };
            body.end = { dateTime: dt, timeZone: "UTC" };
          }
          if (t.external_id)
            await fetch(
              `https://graph.microsoft.com/v1.0/me/events/${t.external_id}`,
              {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(body),
              },
            ).catch(() => {});
        } else if (src.provider === "google_tasks") {
          const [listId, taskId] =
            t.external_id && String(t.external_id).includes(":")
              ? String(t.external_id).split(":", 2)
              : [null, t.external_id];
          let useListId = listId as string | null;
          if (!useListId) {
            const lists = await fetch(
              "https://www.googleapis.com/tasks/v1/users/@me/lists",
              { headers },
            )
              .then((r) => r.json())
              .catch(() => ({ items: [] as any[] }));
            useListId = lists?.items?.[0]?.id || null;
          }
          if (useListId && taskId) {
            const body: any = {
              title: t.title,
              notes: t.description,
              status: t.status === "done" ? "completed" : "needsAction",
            };
            if (t.due_date) {
              body.due = t.due_time
                ? `${t.due_date}T${t.due_time}:00Z`
                : `${t.due_date}T00:00:00Z`;
            } else {
              body.due = null;
            }
            await fetch(
              `https://www.googleapis.com/tasks/v1/lists/${useListId}/tasks/${taskId}`,
              {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(body),
              },
            ).catch(() => {});
          }
        } else if (src.provider === "google_calendar") {
          const body: any = { summary: t.title };
          if (t.due_date) {
            if (t.due_time) {
              body.start = { dateTime: `${t.due_date}T${t.due_time}:00Z` };
              body.end = { dateTime: `${t.due_date}T${t.due_time}:00Z` };
            } else {
              body.start = { date: t.due_date };
              body.end = { date: t.due_date };
            }
          }
          if (t.external_id)
            await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events/${t.external_id}`,
              {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(body),
              },
            ).catch(() => {});
        }
      }
    }
  } catch {}
  broadcast("task_updated", { task });
  return Response.json({ task }, { headers: corsHeaders() });
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: { id: string } },
) {
  const db = getDb();
  const id = Number(params.id);
  const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (!task)
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  await db.run(`DELETE FROM tasks WHERE id = ?`, [id]);
  try {
    const t: any = task;
    if (t?.source_id && t?.external_id) {
      const src = (await db.get(`SELECT * FROM external_sources WHERE id = ?`, [
        t.source_id,
      ])) as any | undefined;
      if (src?.access_token) {
        const headers: HeadersInit = {
          Authorization: `Bearer ${src.access_token}`,
        };
        if (src.provider === "ms_graph_todo") {
          const [listId, taskId] = String(t.external_id).includes(":")
            ? String(t.external_id).split(":", 2)
            : [null, t.external_id];
          if (listId && taskId)
            await fetch(
              `https://graph.microsoft.com/v1.0/me/todo/lists/${listId}/tasks/${taskId}`,
              { method: "DELETE", headers },
            ).catch(() => {});
        } else if (src.provider === "ms_graph_calendar") {
          await fetch(
            `https://graph.microsoft.com/v1.0/me/events/${t.external_id}`,
            { method: "DELETE", headers },
          ).catch(() => {});
        } else if (src.provider === "google_tasks") {
          const [listId, taskId] = String(t.external_id).includes(":")
            ? String(t.external_id).split(":", 2)
            : [null, t.external_id];
          if (listId && taskId)
            await fetch(
              `https://www.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
              { method: "DELETE", headers },
            ).catch(() => {});
        } else if (src.provider === "google_calendar") {
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${t.external_id}`,
            { method: "DELETE", headers },
          ).catch(() => {});
        }
      }
    }
  } catch {}
  broadcast("task_deleted", { id });
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function OPTIONS() {
  return preflight();
}
