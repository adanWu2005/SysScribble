/**
 * Hand-maintained Supabase `Database` type matching `supabase/migrations/*.sql`.
 * Keep in sync with the migrations; `supabase gen types typescript` produces the same shape.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          /** PostgREST encodes bytea as a `\x`-prefixed hex string. */
          yjs_snapshot: string | null;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title?: string;
          yjs_snapshot?: string | null;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          yjs_snapshot?: string | null;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      room_members: {
        Row: {
          room_id: string;
          user_id: string;
          role: Database['public']['Enums']['room_role'];
          joined_at: string;
        };
        Insert: {
          room_id: string;
          user_id: string;
          role?: Database['public']['Enums']['room_role'];
          joined_at?: string;
        };
        Update: {
          room_id?: string;
          user_id?: string;
          role?: Database['public']['Enums']['room_role'];
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'room_members_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'room_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      room_invites: {
        Row: {
          id: string;
          room_id: string;
          email: string;
          role: Database['public']['Enums']['room_role'];
          token_hash: string;
          expires_at: string;
          accepted_at: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          email: string;
          role?: Database['public']['Enums']['room_role'];
          token_hash: string;
          expires_at: string;
          accepted_at?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          email?: string;
          role?: Database['public']['Enums']['room_role'];
          token_hash?: string;
          expires_at?: string;
          accepted_at?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'room_invites_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      room_assets: {
        Row: {
          id: string;
          room_id: string;
          uploaded_by: string;
          r2_object_key: string;
          mime_type: string;
          size_bytes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          uploaded_by: string;
          r2_object_key: string;
          mime_type: string;
          size_bytes: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          uploaded_by?: string;
          r2_object_key?: string;
          mime_type?: string;
          size_bytes?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'room_assets_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      room_snapshots: {
        Row: {
          id: string;
          room_id: string;
          version: number;
          yjs_snapshot: string;
          size_bytes: number;
          label: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          version: number;
          yjs_snapshot: string;
          size_bytes: number;
          label?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          version?: number;
          yjs_snapshot?: string;
          size_bytes?: number;
          label?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'room_snapshots_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_room_with_owner: {
        Args: { p_title: string; p_owner_id: string };
        Returns: string;
      };
      accept_invite: {
        Args: { p_token_hash: string; p_user_id: string; p_email: string };
        Returns: string;
      };
      accept_invite_by_id: {
        Args: { p_invite_id: string; p_user_id: string; p_email: string };
        Returns: string;
      };
      decline_invite: {
        Args: { p_invite_id: string; p_email: string };
        Returns: boolean;
      };
      list_pending_invites: {
        Args: { p_email: string };
        Returns: {
          invite_id: string;
          room_id: string;
          room_title: string;
          role: Database['public']['Enums']['room_role'];
          invited_by_name: string;
          expires_at: string;
          created_at: string;
        }[];
      };
      reserve_room_asset: {
        Args: {
          p_id: string;
          p_room_id: string;
          p_uploaded_by: string;
          p_key: string;
          p_mime: string;
          p_size: number;
          p_quota: number;
        };
        Returns: boolean;
      };
      record_room_checkpoint: {
        Args: { p_room_id: string; p_label: string };
        Returns: string | null;
      };
      room_storage_bytes: {
        Args: { p_room_id: string };
        Returns: number;
      };
      is_room_member: {
        Args: { p_room_id: string };
        Returns: boolean;
      };
      room_role_of: {
        Args: { p_room_id: string };
        Returns: Database['public']['Enums']['room_role'] | null;
      };
    };
    Enums: {
      room_role: 'OWNER' | 'EDITOR' | 'VIEWER';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
