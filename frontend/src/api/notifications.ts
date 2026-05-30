import api from "../lib/api";

export interface Notification {
  id: string;
  type: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  unread_count: number;
  notifications: Notification[];
}

export const notificationsApi = {
  list: () =>
    api.get<NotificationsResponse>("/notifications").then((r) => r.data),

  markRead: (id: string) =>
    api.post(`/notifications/${id}/read`).then((r) => r.data),
};
