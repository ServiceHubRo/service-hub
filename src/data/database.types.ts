// GENERATED from the database schema — do not edit by hand.
// Regenerate after every migration: npm run db:types (needs the local Supabase stack: npx supabase start).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          car_id?: string | null
          car_snapshot?: Json
          client_id?: string | null
          client_lang?: string
          client_name?: string | null
          client_phone?: string | null
          confirmed_at?: string | null
          cost?: number | null
          created_at?: string
          date: string
          decline_reason?: string | null
          done_at?: string | null
          id?: string
          inspection_started_at?: string | null
          note?: string | null
          odometer?: number | null
          ref?: string
          reminder_sent_at?: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at?: string | null
          status?: string
          status_changed_at?: string
          updated_at?: string
          work?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          car_id?: string | null
          car_snapshot?: Json
          client_id?: string | null
          client_lang?: string
          client_name?: string | null
          client_phone?: string | null
          confirmed_at?: string | null
          cost?: number | null
          created_at?: string
          date?: string
          decline_reason?: string | null
          done_at?: string | null
          id?: string
          inspection_started_at?: string | null
          note?: string | null
          odometer?: number | null
          ref?: string
          reminder_sent_at?: string | null
          service_id?: string
          shop_id?: string
          slot?: string
          started_at?: string | null
          status?: string
          status_changed_at?: string
          updated_at?: string
          work?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "bookings_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      cars: {
        Row: {
          created_at: string
          id: string
          itp_expiry: string | null
          make: string
          model: string
          owner_id: string
          plate: string | null
          plate_norm: string | null
          rca_expiry: string | null
          reminded: Json
          updated_at: string
          vignette_expiry: string | null
          vin: string | null
          year: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          itp_expiry?: string | null
          make: string
          model: string
          owner_id?: string
          plate?: string | null
          plate_norm?: string | null
          rca_expiry?: string | null
          reminded?: Json
          updated_at?: string
          vignette_expiry?: string | null
          vin?: string | null
          year?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          itp_expiry?: string | null
          make?: string
          model?: string
          owner_id?: string
          plate?: string | null
          plate_norm?: string | null
          rca_expiry?: string | null
          reminded?: Json
          updated_at?: string
          vignette_expiry?: string | null
          vin?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cars_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          client_id: string
          created_at: string
          shop_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          shop_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "favorites_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      history_reports: {
        Row: {
          amount_paid: number
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          code: string
          created_at: string
          generated_at: string | null
          id: string
          job_count: number
          jobs: Json
          lang: string
          latest_odometer: number | null
          odometer_out_of_order: boolean
          paid_at: string | null
          pdf_url: string | null
          period_from: string | null
          period_to: string | null
          price: number
          request_id: string | null
          status: string
          stripe_session_id: string | null
          total_amount: number
          vehicle_key: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount_paid?: number
          car_id?: string | null
          car_snapshot: Json
          client_id?: string | null
          code?: string
          created_at?: string
          generated_at?: string | null
          id?: string
          job_count?: number
          jobs?: Json
          lang?: string
          latest_odometer?: number | null
          odometer_out_of_order?: boolean
          paid_at?: string | null
          pdf_url?: string | null
          period_from?: string | null
          period_to?: string | null
          price?: number
          request_id?: string | null
          status?: string
          stripe_session_id?: string | null
          total_amount?: number
          vehicle_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount_paid?: number
          car_id?: string | null
          car_snapshot?: Json
          client_id?: string | null
          code?: string
          created_at?: string
          generated_at?: string | null
          id?: string
          job_count?: number
          jobs?: Json
          lang?: string
          latest_odometer?: number | null
          odometer_out_of_order?: boolean
          paid_at?: string | null
          pdf_url?: string | null
          period_from?: string | null
          period_to?: string | null
          price?: number
          request_id?: string | null
          status?: string
          stripe_session_id?: string | null
          total_amount?: number
          vehicle_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "history_reports_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "history_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          issued_at: string | null
          number: string | null
          pdf_url: string | null
          period_end: string | null
          provider: string | null
          provider_ref: string | null
          receipt_url: string | null
          series: string | null
          shop_id: string
          status: string
          stripe_invoice_id: string | null
          vat_amount: number
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          issued_at?: string | null
          number?: string | null
          pdf_url?: string | null
          period_end?: string | null
          provider?: string | null
          provider_ref?: string | null
          receipt_url?: string | null
          series?: string | null
          shop_id: string
          status?: string
          stripe_invoice_id?: string | null
          vat_amount?: number
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          issued_at?: string | null
          number?: string | null
          pdf_url?: string | null
          period_end?: string | null
          provider?: string | null
          provider_ref?: string | null
          receipt_url?: string | null
          series?: string | null
          shop_id?: string
          status?: string
          stripe_invoice_id?: string | null
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "invoices_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          booking_id: string | null
          created_at: string
          event: string | null
          id: string
          kind: string
          params: Json
          sender_id: string | null
          thread_id: string
        }
        Insert: {
          body?: string | null
          booking_id?: string | null
          created_at?: string
          event?: string | null
          id?: string
          kind: string
          params?: Json
          sender_id?: string | null
          thread_id: string
        }
        Update: {
          body?: string | null
          booking_id?: string | null
          created_at?: string
          event?: string | null
          id?: string
          kind?: string
          params?: Json
          sender_id?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_reads: {
        Row: {
          notice_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notice_id: string
          read_at?: string
          user_id?: string
        }
        Update: {
          notice_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_reads_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          audience: string
          body_en: string
          body_ro: string
          city: string | null
          created_at: string
          created_by: string | null
          id: string
          push_recipients: number
          recipients: number
          send_push: boolean
          title_en: string
          title_ro: string
        }
        Insert: {
          audience: string
          body_en: string
          body_ro: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          push_recipients?: number
          recipients?: number
          send_push?: boolean
          title_en: string
          title_ro: string
        }
        Update: {
          audience?: string
          body_en?: string
          body_ro?: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          push_recipients?: number
          recipients?: number
          send_push?: boolean
          title_en?: string
          title_ro?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          attempts: number
          booking_id: string | null
          channels: string[]
          channels_done: string[]
          created_at: string
          event: string
          id: string
          last_error: string | null
          locked_until: string | null
          params: Json
          processed_at: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number
          booking_id?: string | null
          channels?: string[]
          channels_done?: string[]
          created_at?: string
          event: string
          id?: string
          last_error?: string | null
          locked_until?: string | null
          params?: Json
          processed_at?: string | null
          user_id?: string | null
        }
        Update: {
          attempts?: number
          booking_id?: string | null
          channels?: string[]
          channels_done?: string[]
          created_at?: string
          event?: string
          id?: string
          last_error?: string | null
          locked_until?: string | null
          params?: Json
          processed_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications_log: {
        Row: {
          channel: string
          error: string | null
          event_id: string | null
          id: string
          sent_at: string
          status: string
          user_id: string | null
        }
        Insert: {
          channel: string
          error?: string | null
          event_id?: string | null
          id?: string
          sent_at?: string
          status: string
          user_id?: string | null
        }
        Update: {
          channel?: string
          error?: string | null
          event_id?: string | null
          id?: string
          sent_at?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_verifications: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          phone: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          phone: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          default_cancel_deadline_hours: number
          default_cars_per_slot: number
          default_daily_capacity: number
          default_max_advance_days: number
          default_min_notice_hours: number
          default_slot_minutes: number
          id: number
          launch_price_ron: number
          launch_shops: number
          limits: Json
          notification_texts: Json
          quote_expiry_days: number
          ranking_prior_avg: number
          ranking_prior_weight: number
          report_price_ron: number
          staff_free_seats: number
          staff_seat_price_ron: number
          subscription_price_ron: number
          trial_days: number
          updated_at: string
          updated_by: string | null
          vat_rate_percent: number
        }
        Insert: {
          default_cancel_deadline_hours?: number
          default_cars_per_slot?: number
          default_daily_capacity?: number
          default_max_advance_days?: number
          default_min_notice_hours?: number
          default_slot_minutes?: number
          id?: number
          launch_price_ron?: number
          launch_shops?: number
          limits?: Json
          notification_texts?: Json
          quote_expiry_days?: number
          ranking_prior_avg?: number
          ranking_prior_weight?: number
          report_price_ron?: number
          staff_free_seats?: number
          staff_seat_price_ron?: number
          subscription_price_ron?: number
          trial_days?: number
          updated_at?: string
          updated_by?: string | null
          vat_rate_percent?: number
        }
        Update: {
          default_cancel_deadline_hours?: number
          default_cars_per_slot?: number
          default_daily_capacity?: number
          default_max_advance_days?: number
          default_min_notice_hours?: number
          default_slot_minutes?: number
          id?: number
          launch_price_ron?: number
          launch_shops?: number
          limits?: Json
          notification_texts?: Json
          quote_expiry_days?: number
          ranking_prior_avg?: number
          ranking_prior_weight?: number
          report_price_ron?: number
          staff_free_seats?: number
          staff_seat_price_ron?: number
          subscription_price_ron?: number
          trial_days?: number
          updated_at?: string
          updated_by?: string | null
          vat_rate_percent?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          display_id: string
          email_verified_at: string | null
          id: string
          lang: string
          last_active_at: string | null
          location_prompt_dismissed_at: string | null
          name: string | null
          phone: string | null
          phone_verified_at: string | null
          phone_verified_by_admin: boolean
          push_prompt_dismissed_at: string | null
          role: string
          suspended: boolean
          terms_accepted_at: string | null
          terms_version: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          display_id: string
          email_verified_at?: string | null
          id: string
          lang?: string
          last_active_at?: string | null
          location_prompt_dismissed_at?: string | null
          name?: string | null
          phone?: string | null
          phone_verified_at?: string | null
          phone_verified_by_admin?: boolean
          push_prompt_dismissed_at?: string | null
          role: string
          suspended?: boolean
          terms_accepted_at?: string | null
          terms_version?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          display_id?: string
          email_verified_at?: string | null
          id?: string
          lang?: string
          last_active_at?: string | null
          location_prompt_dismissed_at?: string | null
          name?: string | null
          phone?: string | null
          phone_verified_at?: string | null
          phone_verified_by_admin?: boolean
          push_prompt_dismissed_at?: string | null
          role?: string
          suspended?: boolean
          terms_accepted_at?: string | null
          terms_version?: string | null
        }
        Relationships: []
      }
      push_config: {
        Row: {
          dispatch_token: string
          dispatch_url: string | null
          extra_push_origins: string[]
          id: number
          updated_at: string
          vapid_private_jwk: Json | null
          vapid_public_key: string | null
        }
        Insert: {
          dispatch_token?: string
          dispatch_url?: string | null
          extra_push_origins?: string[]
          id?: number
          updated_at?: string
          vapid_private_jwk?: Json | null
          vapid_public_key?: string | null
        }
        Update: {
          dispatch_token?: string
          dispatch_url?: string | null
          extra_push_origins?: string[]
          id?: number
          updated_at?: string
          vapid_private_jwk?: Json | null
          vapid_public_key?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          last_success_at: string | null
          subscription: Json
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          last_success_at?: string | null
          subscription: Json
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          last_success_at?: string | null
          subscription?: Json
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          approved: boolean | null
          created_at: string
          id: string
          name: string
          position: number
          price: number
          quote_id: string
        }
        Insert: {
          approved?: boolean | null
          created_at?: string
          id?: string
          name: string
          position: number
          price: number
          quote_id: string
        }
        Update: {
          approved?: boolean | null
          created_at?: string
          id?: string
          name?: string
          position?: number
          price?: number
          quote_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          booking_id: string
          created_at: string
          decided_at: string | null
          expires_at: string | null
          expiry_reminded_at: string | null
          id: string
          inspection_fee: number
          note: string | null
          sent_at: string
          sent_by: string | null
          status: string
          total_approved: number | null
          total_sent: number
          version: number
        }
        Insert: {
          booking_id: string
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          expiry_reminded_at?: string | null
          id?: string
          inspection_fee?: number
          note?: string | null
          sent_at?: string
          sent_by?: string | null
          status?: string
          total_approved?: number | null
          total_sent: number
          version: number
        }
        Update: {
          booking_id?: string
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          expiry_reminded_at?: string | null
          id?: string
          inspection_fee?: number
          note?: string | null
          sent_at?: string
          sent_by?: string | null
          status?: string
          total_approved?: number | null
          total_sent?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      request_log: {
        Row: {
          created_at: string
          fn: string
          request_id: string
          result: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          fn: string
          request_id: string
          result?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          fn?: string
          request_id?: string
          result?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          booking_id: string
          client_display_name: string
          client_id: string | null
          created_at: string
          id: string
          rating: number
          removed_at: string | null
          reply: string | null
          reply_at: string | null
          report_decided_at: string | null
          report_note: string | null
          report_reason: string | null
          report_status: string | null
          reported_at: string | null
          shop_id: string
          text: string | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          client_display_name: string
          client_id?: string | null
          created_at?: string
          id?: string
          rating: number
          removed_at?: string | null
          reply?: string | null
          reply_at?: string | null
          report_decided_at?: string | null
          report_note?: string | null
          report_reason?: string | null
          report_status?: string | null
          reported_at?: string | null
          shop_id: string
          text?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          client_display_name?: string
          client_id?: string | null
          created_at?: string
          id?: string
          rating?: number
          removed_at?: string | null
          reply?: string | null
          reply_at?: string | null
          report_decided_at?: string | null
          report_note?: string | null
          report_reason?: string | null
          report_status?: string | null
          reported_at?: string | null
          shop_id?: string
          text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "reviews_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_version: {
        Row: {
          id: number
          version: number
        }
        Insert: {
          id?: number
          version: number
        }
        Update: {
          id?: number
          version?: number
        }
        Relationships: []
      }
      service_categories: {
        Row: {
          enabled: boolean
          key: string
          name_en: string
          name_ro: string
          position: number
        }
        Insert: {
          enabled?: boolean
          key: string
          name_en: string
          name_ro: string
          position?: number
        }
        Update: {
          enabled?: boolean
          key?: string
          name_en?: string
          name_ro?: string
          position?: number
        }
        Relationships: []
      }
      services: {
        Row: {
          category_key: string
          enabled: boolean
          icon: string | null
          id: string
          name_en: string
          name_ro: string
          position: number
        }
        Insert: {
          category_key: string
          enabled?: boolean
          icon?: string | null
          id: string
          name_en: string
          name_ro: string
          position?: number
        }
        Update: {
          category_key?: string
          enabled?: boolean
          icon?: string | null
          id?: string
          name_en?: string
          name_ro?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "services_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["key"]
          },
        ]
      }
      shop_billing: {
        Row: {
          bank_name: string | null
          billing_email: string | null
          created_at: string
          iban: string | null
          legal_address: string | null
          legal_name: string | null
          legal_rep: string | null
          reg_com: string | null
          shop_id: string
          updated_at: string
          vat_id: string | null
          vat_payer: boolean
        }
        Insert: {
          bank_name?: string | null
          billing_email?: string | null
          created_at?: string
          iban?: string | null
          legal_address?: string | null
          legal_name?: string | null
          legal_rep?: string | null
          reg_com?: string | null
          shop_id: string
          updated_at?: string
          vat_id?: string | null
          vat_payer?: boolean
        }
        Update: {
          bank_name?: string | null
          billing_email?: string | null
          created_at?: string
          iban?: string | null
          legal_address?: string | null
          legal_name?: string | null
          legal_rep?: string | null
          reg_com?: string | null
          shop_id?: string
          updated_at?: string
          vat_id?: string | null
          vat_payer?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "shop_billing_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "shop_billing_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_closures: {
        Row: {
          created_at: string
          end_date: string
          id: string
          label: string | null
          shop_id: string
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          label?: string | null
          shop_id: string
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          label?: string | null
          shop_id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_closures_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "shop_closures_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_hours: {
        Row: {
          close_time: string | null
          is_closed: boolean
          open_time: string | null
          shop_id: string
          weekday: number
        }
        Insert: {
          close_time?: string | null
          is_closed?: boolean
          open_time?: string | null
          shop_id: string
          weekday: number
        }
        Update: {
          close_time?: string | null
          is_closed?: boolean
          open_time?: string | null
          shop_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_hours_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "shop_hours_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_services: {
        Row: {
          created_at: string
          service_id: string
          shop_id: string
        }
        Insert: {
          created_at?: string
          service_id: string
          shop_id: string
        }
        Update: {
          created_at?: string
          service_id?: string
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_services_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "shop_services_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_staff: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invite_emailed_at: string | null
          invite_emailed_hash: string | null
          invite_token_hash: string | null
          invited_at: string
          invited_email: string | null
          role: string
          shop_id: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invite_emailed_at?: string | null
          invite_emailed_hash?: string | null
          invite_token_hash?: string | null
          invited_at?: string
          invited_email?: string | null
          role?: string
          shop_id: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invite_emailed_at?: string | null
          invite_emailed_hash?: string | null
          invite_token_hash?: string | null
          invited_at?: string
          invited_email?: string | null
          role?: string
          shop_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_staff_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "shop_staff_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          active: boolean
          billing_reminder_dismissed_at: string | null
          cancel_deadline_hours: number
          capacity_reviewed_at: string | null
          cars_per_slot: number
          city: string
          county: string | null
          created_at: string
          daily_capacity: number
          daily_digest: boolean
          description: string | null
          facebook: string | null
          hours_reviewed_at: string | null
          id: string
          inspection_fee: number
          lang: string
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          max_advance_days: number
          min_notice_hours: number
          name: string
          owner_id: string
          phone: string | null
          phone2: string | null
          postal_code: string | null
          setup_completed_at: string | null
          slot_minutes: number
          sms_on_new_booking: boolean
          street: string | null
          suspended: boolean
          updated_at: string
          website: string | null
          year_established: number | null
        }
        Insert: {
          active?: boolean
          billing_reminder_dismissed_at?: string | null
          cancel_deadline_hours?: number
          capacity_reviewed_at?: string | null
          cars_per_slot?: number
          city: string
          county?: string | null
          created_at?: string
          daily_capacity?: number
          daily_digest?: boolean
          description?: string | null
          facebook?: string | null
          hours_reviewed_at?: string | null
          id?: string
          inspection_fee?: number
          lang?: string
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          max_advance_days?: number
          min_notice_hours?: number
          name: string
          owner_id: string
          phone?: string | null
          phone2?: string | null
          postal_code?: string | null
          setup_completed_at?: string | null
          slot_minutes?: number
          sms_on_new_booking?: boolean
          street?: string | null
          suspended?: boolean
          updated_at?: string
          website?: string | null
          year_established?: number | null
        }
        Update: {
          active?: boolean
          billing_reminder_dismissed_at?: string | null
          cancel_deadline_hours?: number
          capacity_reviewed_at?: string | null
          cars_per_slot?: number
          city?: string
          county?: string | null
          created_at?: string
          daily_capacity?: number
          daily_digest?: boolean
          description?: string | null
          facebook?: string | null
          hours_reviewed_at?: string | null
          id?: string
          inspection_fee?: number
          lang?: string
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          max_advance_days?: number
          min_notice_hours?: number
          name?: string
          owner_id?: string
          phone?: string | null
          phone2?: string | null
          postal_code?: string | null
          setup_completed_at?: string | null
          slot_minutes?: number
          sms_on_new_booking?: boolean
          street?: string | null
          suspended?: boolean
          updated_at?: string
          website?: string | null
          year_established?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shops_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          created_at: string
          id: string
          payload: Json
          processed_at: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id: string
          payload: Json
          processed_at?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          type?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billed_seats: number | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          ended_reason: string | null
          free_seats: number
          launch_offer: boolean
          next_payment_attempt: string | null
          payment_failed_at: string | null
          payment_failed_key: string | null
          price_ron: number
          seat_price_ron: number
          seats: number
          shop_id: string
          status: string
          status_changed_at: string | null
          stripe_customer_id: string | null
          stripe_status: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          trial_reminded: Json
          updated_at: string
        }
        Insert: {
          billed_seats?: number | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          ended_reason?: string | null
          free_seats?: number
          launch_offer?: boolean
          next_payment_attempt?: string | null
          payment_failed_at?: string | null
          payment_failed_key?: string | null
          price_ron: number
          seat_price_ron?: number
          seats?: number
          shop_id: string
          status?: string
          status_changed_at?: string | null
          stripe_customer_id?: string | null
          stripe_status?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          trial_reminded?: Json
          updated_at?: string
        }
        Update: {
          billed_seats?: number | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          ended_reason?: string | null
          free_seats?: number
          launch_offer?: boolean
          next_payment_attempt?: string | null
          payment_failed_at?: string | null
          payment_failed_key?: string | null
          price_ron?: number
          seat_price_ron?: number
          seats?: number
          shop_id?: string
          status?: string
          status_changed_at?: string | null
          stripe_customer_id?: string | null
          stripe_status?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          trial_reminded?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "subscriptions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      threads: {
        Row: {
          client_id: string | null
          client_last_read_at: string | null
          client_name: string | null
          created_at: string
          id: string
          last_message_at: string | null
          shop_id: string
          shop_last_read_at: string | null
        }
        Insert: {
          client_id?: string | null
          client_last_read_at?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          shop_id: string
          shop_last_read_at?: string | null
        }
        Update: {
          client_id?: string | null
          client_last_read_at?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          shop_id?: string
          shop_last_read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_ratings"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "threads_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      shop_ratings: {
        Row: {
          average: number | null
          rating_sum: number | null
          review_count: number | null
          shop_id: string | null
          weighted_score: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      account_email: { Args: { p_user_id: string }; Returns: string }
      admin_account_deletion: {
        Args: { p_admin_id: string; p_user_id: string }
        Returns: string
      }
      admin_audit: {
        Args: {
          p_action: string
          p_after: Json
          p_before: Json
          p_entity_id: string
          p_entity_type: string
        }
        Returns: undefined
      }
      admin_audit_key: {
        Args: {
          p_action: string
          p_after: Json
          p_before: Json
          p_entity_id: string
          p_entity_type: string
        }
        Returns: undefined
      }
      admin_create_category: {
        Args: {
          p_key: string
          p_name_en: string
          p_name_ro: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_create_service: {
        Args: {
          p_category_key: string
          p_icon: string
          p_id: string
          p_name_en: string
          p_name_ro: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_decide_review: {
        Args: {
          p_decision: string
          p_note: string
          p_request_id: string
          p_review_id: string
        }
        Returns: Json
      }
      admin_export: {
        Args: { p_filters?: Json; p_kind: string }
        Returns: Json
      }
      admin_extend_trial: {
        Args: { p_days: number; p_request_id: string; p_shop_id: string }
        Returns: Json
      }
      admin_force_cancel: {
        Args: { p_booking_id: string; p_reason: string; p_request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_get_booking: { Args: { p_booking_id: string }; Returns: Json }
      admin_get_client: { Args: { p_user_id: string }; Returns: Json }
      admin_get_shop: { Args: { p_shop_id: string }; Returns: Json }
      admin_get_thread: { Args: { p_thread_id: string }; Returns: Json }
      admin_list_audit: {
        Args: { p_before?: string; p_limit?: number }
        Returns: Json
      }
      admin_list_bookings: {
        Args: {
          p_client_id?: string
          p_from?: string
          p_limit?: number
          p_q?: string
          p_shop_id?: string
          p_statuses?: string[]
          p_to?: string
        }
        Returns: Json
      }
      admin_list_catalog: { Args: never; Returns: Json }
      admin_list_clients: { Args: never; Returns: Json }
      admin_list_history_reports: { Args: never; Returns: Json }
      admin_list_notices: { Args: never; Returns: Json }
      admin_list_reviews: { Args: { p_q?: string }; Returns: Json }
      admin_list_shops: { Args: never; Returns: Json }
      admin_list_subscriptions: { Args: never; Returns: Json }
      admin_move_catalog_item: {
        Args: {
          p_direction: number
          p_id: string
          p_kind: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_notice_preview: {
        Args: { p_audience: string; p_city: string }
        Returns: Json
      }
      admin_overview: { Args: never; Returns: Json }
      admin_review_json: {
        Args: { p_review: Database["public"]["Tables"]["reviews"]["Row"] }
        Returns: Json
      }
      admin_send_notice: {
        Args: {
          p_audience: string
          p_body_en: string
          p_body_ro: string
          p_city: string
          p_push: boolean
          p_request_id: string
          p_title_en: string
          p_title_ro: string
        }
        Returns: Json
      }
      admin_set_account_suspended: {
        Args: {
          p_reason: string
          p_request_id: string
          p_suspended: boolean
          p_user_id: string
        }
        Returns: Json
      }
      admin_set_notification_text: {
        Args: {
          p_body_en: string
          p_body_ro: string
          p_key: string
          p_request_id: string
          p_title_en: string
          p_title_ro: string
        }
        Returns: Json
      }
      admin_set_shop_suspended: {
        Args: {
          p_reason: string
          p_request_id: string
          p_shop_id: string
          p_suspended: boolean
        }
        Returns: Json
      }
      admin_set_subscription_price: {
        Args: { p_price: number; p_request_id: string; p_shop_id: string }
        Returns: Json
      }
      admin_set_subscription_status: {
        Args: { p_request_id: string; p_shop_id: string; p_status: string }
        Returns: Json
      }
      admin_subscription_rows: { Args: never; Returns: Json }
      admin_thread_messages: { Args: { p_thread_id: string }; Returns: Json }
      admin_update_category: {
        Args: {
          p_enabled: boolean
          p_key: string
          p_name_en: string
          p_name_ro: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_update_service: {
        Args: {
          p_category_key: string
          p_enabled: boolean
          p_icon: string
          p_id: string
          p_name_en: string
          p_name_ro: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_update_settings: {
        Args: { p_request_id: string; p_settings: Json }
        Returns: Json
      }
      admin_update_shop: {
        Args: {
          p_billing: Json
          p_request_id: string
          p_shop: Json
          p_shop_id: string
        }
        Returns: Json
      }
      admin_verify_phone: {
        Args: { p_request_id: string; p_user_id: string }
        Returns: Json
      }
      admin_void_history_report: {
        Args: { p_reason: string; p_report_id: string; p_request_id: string }
        Returns: Json
      }
      admin_withdraw_notice: {
        Args: { p_notice_id: string; p_request_id: string }
        Returns: Json
      }
      app_limit: { Args: { p_default: number; p_key: string }; Returns: number }
      audit_entries: {
        Args: { p_entity_ids: string[]; p_limit?: number }
        Returns: Json
      }
      begin_history_report: {
        Args: {
          p_booking_id: string
          p_car_id: string
          p_lang: string
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      booking_event_params: {
        Args: { p_booking: Database["public"]["Tables"]["bookings"]["Row"] }
        Returns: Json
      }
      booking_thread: { Args: { p_booking_id: string }; Returns: string }
      bucharest_today: { Args: never; Returns: string }
      can_read_booking: { Args: { p_booking_id: string }; Returns: boolean }
      can_read_notice: {
        Args: { p_audience: string; p_city: string }
        Returns: boolean
      }
      can_read_shop: { Args: { p_shop_id: string }; Returns: boolean }
      can_read_thread: { Args: { p_thread_id: string }; Returns: boolean }
      cancel_booking: {
        Args: { p_booking_id: string; p_request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_email_change: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      catalog_icon: { Args: { p_icon: string }; Returns: string }
      catalog_names: {
        Args: { p_name_en: string; p_name_ro: string }
        Returns: string[]
      }
      check_phone_code: {
        Args: { p_code: string; p_request_id: string }
        Returns: Json
      }
      check_slot: {
        Args: {
          p_client_rules: boolean
          p_date: string
          p_exclude_booking: string
          p_shop: Database["public"]["Tables"]["shops"]["Row"]
          p_slot: string
        }
        Returns: undefined
      }
      claim_notifications: { Args: { p_limit?: number }; Returns: Json }
      clean_quote_items: {
        Args: { p_items: Json }
        Returns: {
          name: string
          pos: number
          price: number
        }[]
      }
      clean_text: { Args: { p: string }; Returns: string }
      client_no_show_count: {
        Args: { p_client_id: string; p_days?: number }
        Returns: number
      }
      complete_job: {
        Args: {
          p_booking_id: string
          p_confirm_jump?: boolean
          p_cost?: number
          p_odometer: number
          p_request_id: string
          p_work?: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_booking: {
        Args: { p_booking_id: string; p_request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_booking: {
        Args: {
          p_car?: Json
          p_car_id?: string
          p_date: string
          p_note?: string
          p_request_id: string
          p_save_car?: boolean
          p_service_id: string
          p_shop_id: string
          p_slot: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_sent_quote: {
        Args: { p_booking_id: string }
        Returns: {
          booking_id: string
          created_at: string
          decided_at: string | null
          expires_at: string | null
          expiry_reminded_at: string | null
          id: string
          inspection_fee: number
          note: string | null
          sent_at: string
          sent_by: string | null
          status: string
          total_approved: number | null
          total_sent: number
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_quote: {
        Args: {
          p_approved_item_ids: string[]
          p_booking_id: string
          p_quote_id: string
          p_request_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_booking: {
        Args: { p_booking_id: string; p_reason?: string; p_request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dispatch_sweep: { Args: never; Returns: boolean }
      end_expired_trials: { Args: { p_now?: string }; Returns: number }
      ensure_thread: {
        Args: { p_client_id: string; p_shop_id: string }
        Returns: string
      }
      expire_quotes: { Args: never; Returns: number }
      export_my_data: { Args: never; Returns: Json }
      fail: { Args: { p_code: string; p_params?: Json }; Returns: undefined }
      finish_history_report: {
        Args: { p_generated_at?: string; p_path: string; p_report_id: string }
        Returns: boolean
      }
      finish_notifications: { Args: { p_results: Json }; Returns: number }
      fold_text: { Args: { p: string }; Returns: string }
      format_sequence_id: {
        Args: { p_number: number; p_prefix: string; p_width?: number }
        Returns: string
      }
      get_availability: {
        Args: {
          p_days?: number
          p_exclude_booking?: string
          p_from?: string
          p_shop_id: string
          p_slots_for?: string
        }
        Returns: Json
      }
      get_schema_version: { Args: never; Returns: number }
      get_shop_page: { Args: { p_shop_id: string }; Returns: Json }
      get_shop_setup: { Args: never; Returns: Json }
      get_staff_invite: { Args: { p_token: string }; Returns: Json }
      history_report_for: {
        Args: { p_report_id: string; p_user_id: string }
        Returns: Json
      }
      history_report_preview: {
        Args: { p_booking_id?: string; p_car_id?: string }
        Returns: Json
      }
      in_notice_audience: {
        Args: { p_audience: string; p_city: string; p_user_id: string }
        Returns: boolean
      }
      insert_quote: {
        Args: {
          p_booking: Database["public"]["Tables"]["bookings"]["Row"]
          p_items: Json
          p_note: string
        }
        Returns: {
          booking_id: string
          created_at: string
          decided_at: string | null
          expires_at: string | null
          expiry_reminded_at: string | null
          id: string
          inspection_fee: number
          note: string | null
          sent_at: string
          sent_by: string | null
          status: string
          total_approved: number | null
          total_sent: number
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      invite_staff: {
        Args: { p_email: string; p_request_id: string; p_token: string }
        Returns: Json
      }
      invite_token_hash: { Args: { p_token: string }; Returns: string }
      is_active_status: { Args: { p_status: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_push_endpoint: { Args: { p_url: string }; Returns: boolean }
      is_shop_member: { Args: { p_shop_id: string }; Returns: boolean }
      is_shop_owner: { Args: { p_shop_id: string }; Returns: boolean }
      is_shop_public: { Args: { p_shop_id: string }; Returns: boolean }
      is_valid_cui: { Args: { p: string }; Returns: boolean }
      is_valid_iban: { Args: { p: string }; Returns: boolean }
      is_valid_postal_code: { Args: { p: string }; Returns: boolean }
      is_valid_regcom: { Args: { p: string }; Returns: boolean }
      is_valid_vin: { Args: { p: string }; Returns: boolean }
      jsonb_changes: {
        Args: { p_after: Json; p_before: Json; p_keys: string[] }
        Returns: Json
      }
      kick_dispatcher: { Args: never; Returns: boolean }
      last_odometer_for_booking: {
        Args: { p_booking_id: string }
        Returns: number
      }
      last_odometer_for_plate: {
        Args: { p_plate_norm: string }
        Returns: number
      }
      last_seen: { Args: { p_user_id: string }; Returns: string }
      limit_range: { Args: { p_key: string }; Returns: unknown }
      list_shop_bookings: { Args: never; Returns: Json }
      list_shop_history: { Args: never; Returns: Json }
      list_shop_staff: { Args: never; Returns: Json }
      list_threads: {
        Args: never
        Returns: {
          client_id: string
          client_name: string
          last_body: string
          last_event: string
          last_kind: string
          last_message_at: string
          last_own: boolean
          last_params: Json
          shop_id: string
          shop_logo_url: string
          shop_name: string
          thread_id: string
          unread: number
        }[]
      }
      lock_booking_as_client: {
        Args: { p_booking_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_booking_as_shop: {
        Args: { p_booking_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_history_report_paid: {
        Args: {
          p_amount: number
          p_paid_at?: string
          p_report_id: string
          p_session_id: string
        }
        Returns: Json
      }
      mark_no_show: {
        Args: { p_booking_id: string; p_request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_thread_read: { Args: { p_thread_id: string }; Returns: string }
      message_is_own_side: {
        Args: {
          p_client_id: string
          p_message: Database["public"]["Tables"]["messages"]["Row"]
          p_side: string
        }
        Returns: boolean
      }
      my_phone_verification: { Args: never; Returns: Json }
      my_shop_id: { Args: never; Returns: string }
      next_history_report_code: { Args: never; Returns: string }
      normalize_code: { Args: { p: string }; Returns: string }
      notify_shop: {
        Args: {
          p_booking_id: string
          p_event: string
          p_owner_channels?: string[]
          p_params: Json
          p_shop_id: string
        }
        Returns: undefined
      }
      notify_shop_owner: {
        Args: {
          p_channels?: string[]
          p_event: string
          p_params: Json
          p_shop_id: string
        }
        Returns: undefined
      }
      notify_user: {
        Args: {
          p_booking_id: string
          p_channels?: string[]
          p_event: string
          p_params: Json
          p_user_id: string
        }
        Returns: undefined
      }
      phone_code_hash: {
        Args: { p_code: string; p_id: string }
        Returns: string
      }
      phone_verify_begin: {
        Args: { p_code: string; p_user_id: string }
        Returns: Json
      }
      phone_verify_cancel: { Args: { p_id: string }; Returns: undefined }
      post_booking_event: {
        Args: {
          p_booking: Database["public"]["Tables"]["bookings"]["Row"]
          p_by: string
          p_event: string
          p_params?: Json
        }
        Returns: undefined
      }
      prepare_account_deletion: { Args: { p_user_id: string }; Returns: string }
      promote_to_admin: { Args: { p_email: string }; Returns: string }
      public_pricing: { Args: never; Returns: Json }
      purge_request_log: { Args: { p_now?: string }; Returns: number }
      record_payment_failed: {
        Args: { p_customer: string; p_invoice: Json }
        Returns: boolean
      }
      record_stripe_invoice: {
        Args: { p_customer: string; p_invoice: Json }
        Returns: Json
      }
      remind_expiring_quotes: { Args: { p_now?: string }; Returns: number }
      replace_quote: {
        Args: {
          p_booking_id: string
          p_items: Json
          p_note?: string
          p_request_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reply_review: {
        Args: { p_reply: string; p_request_id: string; p_review_id: string }
        Returns: {
          booking_id: string
          client_display_name: string
          client_id: string | null
          created_at: string
          id: string
          rating: number
          removed_at: string | null
          reply: string | null
          reply_at: string | null
          report_decided_at: string | null
          report_note: string | null
          report_reason: string | null
          report_status: string | null
          reported_at: string | null
          shop_id: string
          text: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      report_facts: { Args: { p_jobs: Json }; Returns: Json }
      report_jobs: {
        Args: { p_client_id: string; p_vehicle_key: string }
        Returns: Json
      }
      report_review: {
        Args: { p_reason: string; p_request_id: string; p_review_id: string }
        Returns: {
          booking_id: string
          client_display_name: string
          client_id: string | null
          created_at: string
          id: string
          rating: number
          removed_at: string | null
          reply: string | null
          reply_at: string | null
          report_decided_at: string | null
          report_note: string | null
          report_reason: string | null
          report_status: string | null
          reported_at: string | null
          shop_id: string
          text: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      report_vehicle: {
        Args: { p_booking_id: string; p_car_id: string; p_client_id: string }
        Returns: Json
      }
      request_begin: {
        Args: { p_fn: string; p_request_id: string }
        Returns: Json
      }
      request_finish: {
        Args: { p_request_id: string; p_result: Json }
        Returns: undefined
      }
      require_admin: {
        Args: never
        Returns: {
          created_at: string
          deleted_at: string | null
          display_id: string
          email_verified_at: string | null
          id: string
          lang: string
          last_active_at: string | null
          location_prompt_dismissed_at: string | null
          name: string | null
          phone: string | null
          phone_verified_at: string | null
          phone_verified_by_admin: boolean
          push_prompt_dismissed_at: string | null
          role: string
          suspended: boolean
          terms_accepted_at: string | null
          terms_version: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_caller: {
        Args: never
        Returns: {
          created_at: string
          deleted_at: string | null
          display_id: string
          email_verified_at: string | null
          id: string
          lang: string
          last_active_at: string | null
          location_prompt_dismissed_at: string | null
          name: string | null
          phone: string | null
          phone_verified_at: string | null
          phone_verified_by_admin: boolean
          push_prompt_dismissed_at: string | null
          role: string
          suspended: boolean
          terms_accepted_at: string | null
          terms_version: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_my_shop: { Args: never; Returns: string }
      require_my_shop_owner: { Args: never; Returns: string }
      require_status: {
        Args: {
          p_allowed: string[]
          p_booking: Database["public"]["Tables"]["bookings"]["Row"]
        }
        Returns: undefined
      }
      reschedule_booking: {
        Args: {
          p_booking_id: string
          p_date: string
          p_request_id: string
          p_slot: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_display_name: { Args: { p_name: string }; Returns: string }
      run_hourly_jobs: { Args: { p_now?: string }; Returns: Json }
      run_quote_jobs: { Args: { p_now?: string }; Returns: Json }
      save_push_subscription: {
        Args: {
          p_endpoint: string
          p_subscription: Json
          p_user_agent?: string
        }
        Returns: undefined
      }
      save_shop_hours: {
        Args: { p_hours: Json; p_request_id: string }
        Returns: Json
      }
      schedule_notification_jobs: { Args: never; Returns: string }
      search_cities: {
        Args: never
        Returns: {
          city: string
          shop_count: number
        }[]
      }
      search_shops: {
        Args: {
          p_category?: string
          p_city?: string
          p_lat?: number
          p_lng?: number
          p_q?: string
          p_sort?: string
        }
        Returns: {
          average: number
          city: string
          distance_km: number
          is_favorite: boolean
          latitude: number
          logo_url: string
          longitude: number
          matched_service_en: string
          matched_service_id: string
          matched_service_ro: string
          name: string
          review_count: number
          service_count: number
          shop_id: string
          street: string
          weighted_score: number
        }[]
      }
      search_words: { Args: { p_q: string }; Returns: string[] }
      send_appointment_reminders: { Args: { p_now?: string }; Returns: number }
      send_daily_digests: { Args: { p_now?: string }; Returns: number }
      send_doc_expiry_reminders: { Args: { p_today?: string }; Returns: number }
      send_message: {
        Args: { p_body: string; p_request_id: string; p_thread_id: string }
        Returns: {
          body: string | null
          booking_id: string | null
          created_at: string
          event: string | null
          id: string
          kind: string
          params: Json
          sender_id: string | null
          thread_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      send_quote: {
        Args: {
          p_booking_id: string
          p_items: Json
          p_note?: string
          p_request_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      send_trial_warnings: { Args: { p_now?: string }; Returns: number }
      set_billed_seats: {
        Args: { p_seats: number; p_shop_id: string }
        Returns: undefined
      }
      set_history_report_session: {
        Args: { p_report_id: string; p_session_id: string }
        Returns: undefined
      }
      set_shop_services: {
        Args: { p_request_id: string; p_service_ids: string[] }
        Returns: Json
      }
      set_stripe_customer: {
        Args: { p_customer_id: string; p_shop_id: string }
        Returns: string
      }
      set_subscription_status: {
        Args: { p_reason?: string; p_shop_id: string; p_status: string }
        Returns: undefined
      }
      shop_cancel_booking: {
        Args: { p_booking_id: string; p_reason: string; p_request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shop_colleague_count: { Args: { p_shop_id: string }; Returns: number }
      shop_hidden_reasons: { Args: { p_shop_id: string }; Returns: string[] }
      shop_reports: { Args: never; Returns: Json }
      shop_seat_count: { Args: { p_shop_id: string }; Returns: number }
      shop_state: { Args: { p_shop_id: string }; Returns: string }
      slot_starts_at: {
        Args: { p_date: string; p_slot: string }
        Returns: string
      }
      start_inspection: {
        Args: { p_booking_id: string; p_request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_work: {
        Args: { p_booking_id: string; p_request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stripe_event_begin: {
        Args: { p_id: string; p_payload: Json; p_type: string }
        Returns: boolean
      }
      stripe_event_done: { Args: { p_id: string }; Returns: undefined }
      stripe_seat_info: {
        Args: { p_customer?: string; p_shop_id?: string }
        Returns: Json
      }
      submit_review: {
        Args: {
          p_booking_id: string
          p_rating: number
          p_request_id: string
          p_text?: string
        }
        Returns: {
          booking_id: string
          client_display_name: string
          client_id: string | null
          created_at: string
          id: string
          rating: number
          removed_at: string | null
          reply: string | null
          reply_at: string | null
          report_decided_at: string | null
          report_note: string | null
          report_reason: string | null
          report_status: string | null
          reported_at: string | null
          shop_id: string
          text: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      subscription_checkout_info: { Args: { p_user_id: string }; Returns: Json }
      subscription_for_customer: {
        Args: { p_customer: string; p_shop_id?: string }
        Returns: {
          billed_seats: number | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          ended_reason: string | null
          free_seats: number
          launch_offer: boolean
          next_payment_attempt: string | null
          payment_failed_at: string | null
          payment_failed_key: string | null
          price_ron: number
          seat_price_ron: number
          seats: number
          shop_id: string
          status: string
          status_changed_at: string | null
          stripe_customer_id: string | null
          stripe_status: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          trial_reminded: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      subscription_monthly_ron: {
        Args: { p: Database["public"]["Tables"]["subscriptions"]["Row"] }
        Returns: number
      }
      subscription_next_billing: {
        Args: { p: Database["public"]["Tables"]["subscriptions"]["Row"] }
        Returns: string
      }
      subscription_ok: {
        Args: {
          p_status: string
          p_stripe_status: string
          p_trial_ends_at: string
        }
        Returns: boolean
      }
      sync_stripe_subscription: {
        Args: { p_customer: string; p_shop_id: string; p_sub: Json }
        Returns: Json
      }
      toggle_favorite: {
        Args: { p_request_id: string; p_shop_id: string }
        Returns: boolean
      }
      touch_last_active: { Args: never; Returns: undefined }
      try_uuid: { Args: { p: string }; Returns: string }
      vehicle_key: { Args: { p_car: Json }; Returns: string }
      verify_phone_manually: { Args: { p_email: string }; Returns: string }
      verify_report: { Args: { p_code: string }; Returns: Json }
      withdraw_quote: {
        Args: { p_booking_id: string; p_request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          car_id: string | null
          car_snapshot: Json
          client_id: string | null
          client_lang: string
          client_name: string | null
          client_phone: string | null
          confirmed_at: string | null
          cost: number | null
          created_at: string
          date: string
          decline_reason: string | null
          done_at: string | null
          id: string
          inspection_started_at: string | null
          note: string | null
          odometer: number | null
          ref: string
          reminder_sent_at: string | null
          service_id: string
          shop_id: string
          slot: string
          started_at: string | null
          status: string
          status_changed_at: string
          updated_at: string
          work: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

