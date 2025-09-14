export type Person = {
  id: number;
  name: string;
  email?: string | null;
  color?: string | null;
  default_source_id?: number | null;
};

export type Task = {
  id: number;
  title: string;
  description?: string | null;
  person_id?: number | null;
  status: "todo" | "in_progress" | "done";
  due_date?: string | null;
  due_time?: string | null;
  bucket_type?: "day" | "week" | "month" | null;
  bucket_date?: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  interval: number;
  byweekday?: string | null; // JSON array
  until?: string | null;
  sort?: number;
  color?: string | null;
  priority?: number; // 0 none, 1 low, 2 med, 3 high
};

export type ExternalSource = {
  id: number;
  person_id: number;
  provider: string;
  url?: string | null;
};

export type View = "day" | "week" | "month";

export type UserPrefs = {
  relativeDates: boolean;
  timeFormat: '12h' | '24h';
  dateFormat: 'YYYY-MM-DD' | 'MM/DD' | 'DD/MM';
};
