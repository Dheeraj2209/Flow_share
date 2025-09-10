export default function TutorialPage() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Flowshare Tutorial</h1>

      <section>
        <h2 className="text-lg font-semibold mb-2">Core Concepts</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>People: add collaborators, assign colors, and filter tasks per person.</li>
          <li>Tasks: add/edit/delete with due date, due time, priority, color, and assignee.</li>
          <li>Hierarchy: plan by Day, Week, and Month; switch views anytime.</li>
          <li>Realtime: updates sync instantly across connected clients.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Adding People</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Use the sidebar to add a new person; they appear immediately.</li>
          <li>Select a person to filter and edit their color in the sidebar.</li>
          <li>Task accents adopt the person’s color when filtered.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Creating Tasks</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Use the bottom composer: type a title then hit Enter.</li>
          <li>Open modifiers: Assign, Due (date/time), More (recurrence, interval, scope, priority, color).</li>
          <li>Natural language: “Meet Sam @alex Mon 3pm every week #p2 #green #week”.</li>
          <li>Scope determines anchor: Day (date), Week (week start), Month (month start).</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Views & Navigation</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Day/Week/Month toggles at the top; use arrows and Today.</li>
          <li>Grid layout (Week/Month): day cells show tasks; week/month items appear as banners.</li>
          <li>Day Timeline: drag time blocks vertically to adjust due times.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Drag & Drop</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Reorder within a day using the left handle (springy motion).</li>
          <li>Cross-day move using the right grip; drop on a highlighted day.</li>
          <li>Multi-select with Shift/Ctrl/Cmd-click; dragging any selected task moves the group.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Timeline Keyboard Shortcuts</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Alt+Arrow Up/Down: nudge due time by 5 minutes.</li>
          <li>Shift+Arrow Up/Down: nudge due time by 15 minutes.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Connections & Sync</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Select a person → Connections: add Apple Calendar/Reminders, Outlook Calendar, or Microsoft To Do.</li>
          <li>ICS: paste a public .ics URL and Connect. Click “Sync now” anytime.</li>
          <li>Microsoft OAuth: Connect Outlook Calendar or To Do via Microsoft login (requires env setup).</li>
          <li>Sync maps events/tasks to day tasks with titles, dates, and times; updates use source IDs to avoid duplicates.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Customization</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Task colors and priorities surface on chips and rows.</li>
          <li>Person colors theme the UI when filtering.</li>
          <li>Progress bars show completion for “All” and per person in the current window.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Tips</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Use the mini calendar to jump to a date (switches to Day view).</li>
          <li>Use the composer’s quick chips in the Due and More popovers for speed.</li>
          <li>Try #scope tags in quick add: #day, #week, #month.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Backend & Storage</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li><b>Storage</b>: SQLite database at <code>data/app.db</code> (auto-created). Managed via <code>better-sqlite3</code> in <code>src/lib/db.ts</code>.</li>
          <li><b>Backend</b>: Next.js API routes (Node.js runtime) power CRUD and sync:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>People: <code>/api/people</code> (GET, POST), <code>/api/people/[id]</code> (GET, PUT, DELETE)</li>
              <li>Tasks: <code>/api/tasks</code> (GET, POST), <code>/api/tasks/[id]</code> (GET, PUT, DELETE)</li>
              <li>Realtime: <code>/api/stream</code> (SSE)</li>
              <li>Connections: <code>/api/sources</code> (GET, POST), <code>/api/sources/sync</code> (POST)</li>
              <li>Microsoft OAuth: <code>/api/oauth/ms/start</code>, <code>/api/oauth/ms/callback</code></li>
            </ul>
          </li>
          <li><b>Schema & Migrations</b> (auto-applied on boot) in <code>src/lib/db.ts</code>:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li><code>people</code>: <i>id, name, email, color, created_at</i></li>
              <li><code>tasks</code>: <i>id, title, description, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, byweekday, until, sort, color, priority, external_id, source_id, created_at, updated_at</i></li>
              <li><code>external_sources</code>: <i>id, person_id, provider, url, access_token, refresh_token, expires_at, scope, account, created_at</i></li>
            </ul>
          </li>
          <li><b>Realtime</b>: Server‑Sent Events broadcast updates to connected clients. Subscribers are in‑memory; data itself persists in SQLite.</li>
          <li><b>No external DB</b>: Everything is self‑contained in <code>data/app.db</code>, including OAuth tokens and connector metadata.</li>
          <li><b>Inspecting the code</b> (paths you’ll use most):
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>DB + schema: <code>src/lib/db.ts</code></li>
              <li>API routes: <code>src/app/api/**</code> (people, tasks, stream, sources, oauth)</li>
              <li>UI: <code>src/app/page.tsx</code> (main), <code>src/app/tutorial/page.tsx</code> (this page)</li>
            </ul>
          </li>
          <li><b>Viewing files</b> in the terminal:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>List files: <code>ls -la</code></li>
              <li>Find files: <code>rg --files src</code></li>
              <li>View file: <code>sed -n '1,200p' src/lib/db.ts</code></li>
              <li>Search text: <code>rg "external_sources" src</code></li>
            </ul>
          </li>
        </ul>
      </section>
    </div>
  );
}
