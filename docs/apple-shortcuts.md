Apple Reminders Integration via Shortcuts

Overview
- Apple provides EventKit for on-device Calendar/Reminders access, but no public web API for Reminders.
- Use Apple Shortcuts as a lightweight bridge: it pushes Reminders changes to your backend and pulls tasks to mirror back.

Endpoints
1) Webhook (POST): /api/integrations/apple/reminders/webhook
   Body JSON fields:
   - personId: number (required)
   - secret: string (optional; if provided on first call, it is stored and required thereafter)
   - reminderId: string (required; Reminders “Identifier” from Shortcuts)
   - title: string
   - due_date: YYYY-MM-DD (optional)
   - due_time: HH:mm (optional)
   - completed: boolean (optional)
   - deleted: boolean (optional)

   Behavior: Upserts a task mapped by (source=apple_reminders_webhook, external_id=reminderId). Deletes when deleted=true.

2) Pull (GET): /api/integrations/apple/reminders/pull?personId=123&since=ISO
   - Returns: { source_id, tasks: [{ id, title, due_date, due_time, status, external_id, updated_at }] }
   - Includes tasks for the person that either belong to this source or aren’t linked to any source yet.
   - Use `since` to fetch only changes since a timestamp.

Shortcut: Push Changes to Webhook
1) Trigger: “When Reminders Are Added or Changed” (or a periodic automation)
2) Actions:
   - Find Reminders (Filters as needed: List, Is Completed, etc.) or use the trigger-provided reminder
   - Repeat with Each
     - Get Details of Reminder: Identifier, Title, Due Date, Is Completed
     - Format Date (Due Date) → Date: YYYY-MM-DD, Time: HH:mm (guard if no due date)
     - Get Contents of URL
       - URL: https://YOUR_API_BASE/api/integrations/apple/reminders/webhook
       - Method: POST
       - Request Body (JSON):
         {
           "personId": 123,
           "secret": "YOUR_SHARED_SECRET",
           "reminderId": "${Identifier}",
           "title": "${Title}",
           "due_date": "${Date}",
           "due_time": "${Time}",
           "completed": ${Is Completed}
         }

Shortcut: Mirror Backend → Reminders
1) Trigger: Personal Automation → Time of Day (e.g., every hour) or Manual
2) Actions:
   - Get Contents of URL
     - URL: https://YOUR_API_BASE/api/integrations/apple/reminders/pull?personId=123&since=${LastSyncISO}
   - Get Dictionary from (result)
   - Get Value for Key “tasks” → Repeat with Each
     - If “external_id” has value:
       - Find Reminders where Identifier is external_id → Update Reminder (Title, Due Date)
     - Otherwise:
       - Create Reminder (Title, Due Date) → Get New Reminder Identifier
       - POST back to webhook with reminderId + task fields to link (same as above)
   - Store current time as LastSyncISO (using e.g., a file or Notes key if desired)

Security
- Provide a `secret` in the body; it is stored per person on the first call and required thereafter.
- Also set CORS_ORIGIN to your device’s calling context if needed.

Notes
- Due time mapping: if not present, tasks are treated as all-day (date-only).
- Completion: webhook maps completed reminders to status=done, and uncompleted to todo.
- Start with a small subset/list to verify behavior before enabling automations.

