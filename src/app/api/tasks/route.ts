import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { broadcast } from "@/lib/sse";
import { corsHeaders, preflight } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get("personId");
  const where: string[] = [];
  const params: any[] = [];
  if (personId) {
    where.push("person_id = ?");
    params.push(Number(personId));
  }
  const sql = `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`;
  const tasks = await db.query(sql, params);
  const doneDates = await db.query(`SELECT task_id, date FROM task_done_dates`);
  return Response.json({ tasks, doneDates }, { headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => ({}) as any);
  const title = String(body.title || "").trim();
  if (!title)
    return new Response("Title required", {
      status: 400,
      headers: corsHeaders(),
    });
  const description = body.description ? String(body.description) : null;
  const person_id = body.person_id != null ? Number(body.person_id) : null;
  const status =
    body.status && ["todo", "in_progress", "done"].includes(body.status)
      ? body.status
      : "todo";
  const due_date = body.due_date ? String(body.due_date) : null;
  const due_time = body.due_time ? String(body.due_time) : null;
  const bucket_type = body.bucket_type ?? null; // 'day' | 'week' | 'month'
  const bucket_date = body.bucket_date ?? null; // ISO
  const recurrence =
    body.recurrence &&
    ["none", "daily", "weekly", "monthly"].includes(body.recurrence)
      ? body.recurrence
      : "none";
  const interval =
    body.interval != null ? Math.max(1, Number(body.interval)) : 1;
  const byweekday = body.byweekday ? JSON.stringify(body.byweekday) : null;
  const until = body.until ? String(body.until) : null;
  const color = body.color ? String(body.color) : null;
  const priority =
    body.priority != null ? Math.max(0, Math.min(3, Number(body.priority))) : 0;
  // sort ordering for day buckets
  let sort = 0;
  if (
    (bucket_type === "day" ||
      bucket_type === "week" ||
      bucket_type === "month") &&
    bucket_date
  ) {
    const row = (await db.get(
      `SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM tasks WHERE bucket_type=? AND bucket_date=?`,
      [bucket_type, bucket_date],
    )) as any;
    sort = row?.next ?? 0;
  }

  const info = await db.run(
    `INSERT INTO tasks (title, description, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, byweekday, until, sort, color, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      description,
      person_id,
      status,
      due_date,
      due_time,
      bucket_type,
      bucket_date,
      recurrence,
      interval,
      byweekday,
      until,
      sort,
      color,
      priority,
    ],
  );
  let task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [
    info.lastInsertRowid as number,
  ]);

  // Optional: create on external provider if source_id is provided
  try {
    let source_id = body.source_id != null ? Number(body.source_id) : null;
    if (!source_id && person_id != null) {
      const person = (await db.get(
        `SELECT default_source_id FROM people WHERE id = ?`,
        [person_id],
      )) as any | undefined;
      if (person?.default_source_id)
        source_id = Number(person.default_source_id);
    }
    if (source_id) {
      const src = (await db.get(`SELECT * FROM external_sources WHERE id = ?`, [
        source_id,
      ])) as any | undefined;
      if (src?.access_token) {
        const headers: HeadersInit = {
          Authorization: `Bearer ${src.access_token}`,
        };
        const t: any = task;
        if (src.provider === "ms_graph_todo") {
          const lists = await fetch(
            "https://graph.microsoft.com/v1.0/me/todo/lists",
            { headers },
          )
            .then((r) => r.json())
            .catch(() => ({ value: [] as any[] }));
          const firstListId = lists?.value?.[0]?.id;
          if (firstListId) {
            const bodyOut: any = { title };
            if (due_date) {
              const dt = due_time
                ? `${due_date}T${due_time}:00`
                : `${due_date}T00:00:00`;
              bodyOut.dueDateTime = { dateTime: dt, timeZone: "UTC" };
            }
            const created = (await fetch(
              `https://graph.microsoft.com/v1.0/me/todo/lists/${firstListId}/tasks`,
              {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(bodyOut),
              },
            )
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)) as { id?: string } | null;
            if (created?.id) {
              await db.run(
                `UPDATE tasks SET source_id=?, external_id=? WHERE id=?`,
                [source_id, `${firstListId}:${created.id}`, t.id],
              );
              task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [t.id]);
            }
          }
        } else if (src.provider === "ms_graph_calendar") {
          const bodyOut: any = { subject: title };
          if (due_date) {
            const dt = due_time
              ? `${due_date}T${due_time}:00`
              : `${due_date}T00:00:00`;
            bodyOut.start = { dateTime: dt, timeZone: "UTC" };
            bodyOut.end = { dateTime: dt, timeZone: "UTC" };
          }
          const created = (await fetch(
            `https://graph.microsoft.com/v1.0/me/events`,
            {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify(bodyOut),
            },
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)) as { id?: string } | null;
          if (created?.id) {
            await db.run(
              `UPDATE tasks SET source_id=?, external_id=? WHERE id=?`,
              [source_id, created.id, (task as any).id],
            );
            task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [
              (task as any).id,
            ]);
          }
        } else if (src.provider === "google_tasks") {
          const lists = await fetch(
            "https://www.googleapis.com/tasks/v1/users/@me/lists",
            { headers },
          )
            .then((r) => r.json())
            .catch(() => ({ items: [] as any[] }));
          let defaultListId: string | null = null;
          try {
            const dl = (await fetch(
              "https://www.googleapis.com/tasks/v1/users/@me/lists/@default",
              { headers },
            )
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)) as { id?: string } | null;
            if (dl?.id) defaultListId = dl.id as string;
          } catch {}
          const firstListId = defaultListId || lists?.items?.[0]?.id;
          if (firstListId) {
            const bodyOut: any = { title };
            if (due_date) {
              const dueDate = due_date;
              bodyOut.due = due_time
                ? `${dueDate}T${due_time}:00Z`
                : `${dueDate}T00:00:00Z`;
            }
            const created = (await fetch(
              `https://www.googleapis.com/tasks/v1/lists/${firstListId}/tasks`,
              {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(bodyOut),
              },
            )
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)) as { id?: string } | null;
            if (created?.id) {
              await db.run(
                `UPDATE tasks SET source_id=?, external_id=? WHERE id=?`,
                [source_id, `${firstListId}:${created.id}`, (task as any).id],
              );
              task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [
                (task as any).id,
              ]);
            }
          }
        } else if (src.provider === "google_calendar") {
          const bodyOut: any = { summary: title };
          const today = new Date().toISOString().slice(0, 10);
          const dueDate = due_date || today;
          if (due_time) {
            bodyOut.start = { dateTime: `${dueDate}T${due_time}:00Z` };
            bodyOut.end = { dateTime: `${dueDate}T${due_time}:00Z` };
          } else {
            bodyOut.start = { date: dueDate };
            bodyOut.end = { date: dueDate };
          }
          const created = (await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events`,
            {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify(bodyOut),
            },
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)) as { id?: string } | null;
          if (created?.id) {
            await db.run(
              `UPDATE tasks SET source_id=?, external_id=? WHERE id=?`,
              [source_id, created.id, (task as any).id],
            );
            task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [
              (task as any).id,
            ]);
          }
        }
      }
    }
  } catch {}
  broadcast("task_created", { task });
  return Response.json({ task }, { status: 201, headers: corsHeaders() });
}

export async function OPTIONS() {
  return preflight();
}
