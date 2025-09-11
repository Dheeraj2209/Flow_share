import { ExternalSource, Person, Task } from '@/types';

function base() {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || '') as string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function getPeople(): Promise<Person[]> {
  const data = await apiFetch<{ people: Person[] }>(`/api/people`);
  return data.people || [];
}

export async function getTasks(): Promise<{ tasks: Task[]; doneByDate: Map<string, Set<number>> }>{
  const data = await apiFetch<{ tasks: Task[]; doneDates?: { task_id: number; date: string }[] }>(`/api/tasks`);
  const map = new Map<string, Set<number>>();
  if (Array.isArray(data.doneDates)) {
    for (const row of data.doneDates) {
      const date = String(row.date);
      const tid = Number(row.task_id);
      if (!map.has(date)) map.set(date, new Set());
      map.get(date)!.add(tid);
    }
  }
  return { tasks: data.tasks || [], doneByDate: map };
}

export async function getAll() {
  const [people, tasksData] = await Promise.all([getPeople(), getTasks()]);
  return { people, tasks: tasksData.tasks, doneByDate: tasksData.doneByDate };
}

export async function createPerson(name: string) {
  return apiFetch<{ person: Person }>(`/api/people`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
}

export async function updatePerson(id: number, payload: Partial<Person>) {
  return apiFetch<{ person: Person }>(`/api/people/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
}

export async function deletePerson(id: number) {
  await apiFetch<{}>(`/api/people/${id}`, { method: 'DELETE' });
}

export async function createTask(payload: Partial<Task>) {
  return apiFetch<{ task: Task }>(`/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

export async function updateTask(id: number, payload: Partial<Task> & Record<string, any>) {
  return apiFetch<{ task: Task }>(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

export async function deleteTask(id: number) {
  await apiFetch<{}>(`/api/tasks/${id}`, { method: 'DELETE' });
}

export async function toggleTaskDoneOnDate(id: number, dateKey: string, done: boolean) {
  return updateTask(id, { done_on: dateKey, done });
}

export async function getSources(personId: number) {
  return apiFetch<{ sources: ExternalSource[] }>(`/api/sources?personId=${personId}`);
}

export async function createSource(person_id: number, provider: string, url?: string | null) {
  return apiFetch<{ source: ExternalSource }>(`/api/sources`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ person_id, provider, url }) });
}

export async function updateSource(id: number, payload: Partial<ExternalSource>) {
  return apiFetch<{ source: ExternalSource }>(`/api/sources/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
}

export async function syncSource(id: number) {
  return apiFetch<{ ok: boolean }>(`/api/sources/sync`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ source_id: id }) });
}

export async function deleteSource(id: number) {
  await apiFetch<{}>(`/api/sources/${id}`, { method:'DELETE' });
}

