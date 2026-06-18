export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      dated_notes: {
        Row: {
          body: string
          created_at: string
          execution_id: string
          exercise_id: string
          id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          execution_id: string
          exercise_id: string
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          execution_id?: string
          exercise_id?: string
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dated_notes_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dated_notes_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      executions: {
        Row: {
          bpm_avg: number | null
          created_at: string
          duration_min: number | null
          id: string
          owner_id: string
          performed_on: string
          seance_version_id: string | null
          updated_at: string
        }
        Insert: {
          bpm_avg?: number | null
          created_at?: string
          duration_min?: number | null
          id?: string
          owner_id?: string
          performed_on: string
          seance_version_id?: string | null
          updated_at?: string
        }
        Update: {
          bpm_avg?: number | null
          created_at?: string
          duration_min?: number | null
          id?: string
          owner_id?: string
          performed_on?: string
          seance_version_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "executions_seance_version_id_fkey"
            columns: ["seance_version_id"]
            isOneToOne: false
            referencedRelation: "seance_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_notes: {
        Row: {
          body: string
          created_at: string
          exercise_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          exercise_id: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          exercise_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_notes_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          created_at: string
          id: string
          muscle_group: string
          name: string
          owner_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          muscle_group: string
          name: string
          owner_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          muscle_group?: string
          name?: string
          owner_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      performed_sets: {
        Row: {
          created_at: string
          execution_id: string
          exercise_id: string
          exercise_position: number | null
          id: string
          owner_id: string
          reps: number
          rir: number
          set_order: number
          updated_at: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          execution_id: string
          exercise_id: string
          exercise_position?: number | null
          id?: string
          owner_id?: string
          reps: number
          rir: number
          set_order: number
          updated_at?: string
          weight_kg: number
        }
        Update: {
          created_at?: string
          execution_id?: string
          exercise_id?: string
          exercise_position?: number | null
          id?: string
          owner_id?: string
          reps?: number
          rir?: number
          set_order?: number
          updated_at?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "performed_sets_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performed_sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          owner_id: string
          position: number
          reps_max: number
          reps_min: number
          rir_max: number
          rir_min: number
          seance_version_id: string
          sets_max: number
          sets_min: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          owner_id?: string
          position?: number
          reps_max: number
          reps_min: number
          rir_max: number
          rir_min: number
          seance_version_id: string
          sets_max: number
          sets_min: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          owner_id?: string
          position?: number
          reps_max?: number
          reps_min?: number
          rir_max?: number
          rir_min?: number
          seance_version_id?: string
          sets_max?: number
          sets_min?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_seance_version_id_fkey"
            columns: ["seance_version_id"]
            isOneToOne: false
            referencedRelation: "seance_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_activations: {
        Row: {
          activated_at: string
          created_at: string
          id: string
          owner_id: string
          routine_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string
          created_at?: string
          id?: string
          owner_id?: string
          routine_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string
          created_at?: string
          id?: string
          owner_id?: string
          routine_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routine_activations_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
      routines: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      seance_versions: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          seance_id: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id?: string
          seance_id: string
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          seance_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "seance_versions_seance_id_fkey"
            columns: ["seance_id"]
            isOneToOne: false
            referencedRelation: "seances"
            referencedColumns: ["id"]
          },
        ]
      }
      seances: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          position: number
          routine_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string
          position?: number
          routine_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          position?: number
          routine_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seances_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
