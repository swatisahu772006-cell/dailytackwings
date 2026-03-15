export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: any;
}

export interface Habit {
  id: string;
  uid: string;
  name: string;
  icon: string;
  color: string;
  createdAt: any;
  deleted?: boolean;
}

export interface DailyEntry {
  id: string;
  uid: string;
  date: string; // YYYY-MM-DD
  productivity: number; // 1-5
  habits: Record<string, boolean>;
  notes: string;
  isDayCompleted?: boolean;
  createdAt: any;
}

export type OperationType = 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}
