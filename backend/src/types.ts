export interface Env {
  DB: D1Database;
  AI: Ai;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  VAPID_SUBJECT: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  COCOCLOUD_API_KEY?: string;
  COCOCLOUD_CERT_ID?: string;
}

export interface JWTPayload {
  sub: string;
  name: string;
  role: string;
  iat: number;
  exp: number;
}

export interface UserRow {
  id: string;
  name: string;
  role: string;
  accent: string;
  theme: string;
  created_at: number;
}

export interface HabitRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  trigger_cue: string | null;
  action_desc: string | null;
  action_time: string | null;
  action_place: string | null;
  two_min: string | null;
  streak: number;
  last_completed_date: string | null;
  milestone: number;
  goal_ids: string;
  sort_order: number;
  created_at: number;
}

export interface GoalRow {
  id: string;
  user_id: string;
  identity_statement: string;
  color: string;
  icon: string;
  habit_ids: string;
  sort_order: number;
  created_at: number;
}

export interface BudgetEntryRow {
  id: string;
  user_id: string;
  type: string;
  amount_idr: number;
  category: string;
  note: string | null;
  entry_date: string;
  bank_account_id: string | null;
  receipt_img: string | null;
  created_at: number;
}

export interface BankAccountRow {
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  balance: number;
  created_at: number;
}

export interface InventoryItemRow {
  id: string;
  user_id: string;
  name: string;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  purchase_date: string | null;
  category: string;
  note: string | null;
  created_at: number;
}

export interface KidScheduleRow {
  id: string;
  user_id: string;
  kid_name: string;
  title: string;
  type: string;
  day_of_week: string | null;
  schedule_time: string | null;
  schedule_date: string | null;
  note: string | null;
  created_at: number;
}

export interface DebtRow {
  id: string;
  user_id: string;
  type: string;
  person_name: string;
  amount_idr: number;
  due_date: string | null;
  note: string | null;
  status: string;
  created_at: number;
}

export interface DebtPaymentRow {
  id: string;
  debt_id: string;
  user_id: string;
  amount_idr: number;
  payment_date: string;
  status: string;
  note: string | null;
  created_at: number;
}

export interface BudgetLimitRow {
  id: string;
  user_id: string;
  category: string;
  monthly_limit_idr: number;
  month: string;
}

