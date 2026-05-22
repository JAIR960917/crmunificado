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
      cobranca_activities: {
        Row: {
          cobranca_id: string
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          scheduled_date: string
          title: string
          updated_at: string
        }
        Insert: {
          cobranca_id: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          scheduled_date: string
          title: string
          updated_at?: string
        }
        Update: {
          cobranca_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          scheduled_date?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_activities_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "crm_cobrancas"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          cnpj: string | null
          created_at: string
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          cnpj?: string | null
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          cnpj?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_appointments: {
        Row: {
          canal_agendamento: string
          comparecimento: string
          confirmacao: string
          created_at: string
          forma_pagamento: string
          forma_pagamento_venda: string
          id: string
          idade: string
          lead_id: string | null
          nome: string
          previous_status: string
          renovacao_id: string | null
          resumo: string | null
          scheduled_by: string
          scheduled_datetime: string
          status: string
          telefone: string
          updated_at: string
          valor: number
          valor_entrada: number
          valor_venda: number
          venda: string
        }
        Insert: {
          canal_agendamento?: string
          comparecimento?: string
          confirmacao?: string
          created_at?: string
          forma_pagamento?: string
          forma_pagamento_venda?: string
          id?: string
          idade?: string
          lead_id?: string | null
          nome?: string
          previous_status?: string
          renovacao_id?: string | null
          resumo?: string | null
          scheduled_by: string
          scheduled_datetime: string
          status?: string
          telefone?: string
          updated_at?: string
          valor?: number
          valor_entrada?: number
          valor_venda?: number
          venda?: string
        }
        Update: {
          canal_agendamento?: string
          comparecimento?: string
          confirmacao?: string
          created_at?: string
          forma_pagamento?: string
          forma_pagamento_venda?: string
          id?: string
          idade?: string
          lead_id?: string | null
          nome?: string
          previous_status?: string
          renovacao_id?: string | null
          resumo?: string | null
          scheduled_by?: string
          scheduled_datetime?: string
          status?: string
          telefone?: string
          updated_at?: string
          valor?: number
          valor_entrada?: number
          valor_venda?: number
          venda?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_appointments_renovacao_id_fkey"
            columns: ["renovacao_id"]
            isOneToOne: false
            referencedRelation: "crm_renovacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cobranca_checklist_completions: {
        Row: {
          checklist_item_id: string
          cobranca_id: string
          completed_at: string
          completed_by: string
          id: string
          status_id: string
        }
        Insert: {
          checklist_item_id: string
          cobranca_id: string
          completed_at?: string
          completed_by: string
          id?: string
          status_id: string
        }
        Update: {
          checklist_item_id?: string
          cobranca_id?: string
          completed_at?: string
          completed_by?: string
          id?: string
          status_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cobranca_checklist_completions_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "crm_cobranca_status_checklist"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cobranca_checklist_completions_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "crm_cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cobranca_checklist_completions_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "crm_cobranca_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cobranca_column_flow: {
        Row: {
          column_type: string
          created_at: string
          days_to_advance: number
          flow_enabled: boolean
          id: string
          min_parcelas_atraso: number
          next_status_id: string | null
          status_id: string
          updated_at: string
          whatsapp_trigger_campaign_id: string | null
        }
        Insert: {
          column_type?: string
          created_at?: string
          days_to_advance?: number
          flow_enabled?: boolean
          id?: string
          min_parcelas_atraso?: number
          next_status_id?: string | null
          status_id: string
          updated_at?: string
          whatsapp_trigger_campaign_id?: string | null
        }
        Update: {
          column_type?: string
          created_at?: string
          days_to_advance?: number
          flow_enabled?: boolean
          id?: string
          min_parcelas_atraso?: number
          next_status_id?: string | null
          status_id?: string
          updated_at?: string
          whatsapp_trigger_campaign_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_cobranca_column_flow_next_status_id_fkey"
            columns: ["next_status_id"]
            isOneToOne: false
            referencedRelation: "crm_cobranca_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cobranca_column_flow_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: true
            referencedRelation: "crm_cobranca_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cobranca_column_flow_whatsapp_trigger_campaign_id_fkey"
            columns: ["whatsapp_trigger_campaign_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_trigger_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cobranca_flow_events: {
        Row: {
          cobranca_id: string
          created_at: string
          created_by: string | null
          details: Json
          event_type: string
          id: string
          next_status_key: string | null
          next_status_label: string | null
          status_id: string | null
          status_key: string | null
          status_label: string | null
          whatsapp_trigger_campaign_id: string | null
          whatsapp_trigger_campaign_name: string | null
        }
        Insert: {
          cobranca_id: string
          created_at?: string
          created_by?: string | null
          details?: Json
          event_type: string
          id?: string
          next_status_key?: string | null
          next_status_label?: string | null
          status_id?: string | null
          status_key?: string | null
          status_label?: string | null
          whatsapp_trigger_campaign_id?: string | null
          whatsapp_trigger_campaign_name?: string | null
        }
        Update: {
          cobranca_id?: string
          created_at?: string
          created_by?: string | null
          details?: Json
          event_type?: string
          id?: string
          next_status_key?: string | null
          next_status_label?: string | null
          status_id?: string | null
          status_key?: string | null
          status_label?: string | null
          whatsapp_trigger_campaign_id?: string | null
          whatsapp_trigger_campaign_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_cobranca_flow_events_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "crm_cobrancas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cobranca_flow_events_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "crm_cobranca_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cobranca_flow_events_whatsapp_trigger_campaign_id_fkey"
            columns: ["whatsapp_trigger_campaign_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_trigger_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cobranca_notes: {
        Row: {
          cobranca_id: string
          content: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          cobranca_id: string
          content: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          cobranca_id?: string
          content?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cobranca_notes_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "crm_cobrancas"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cobranca_situacao_mapping: {
        Row: {
          created_at: string
          situacao: string
          status_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          situacao: string
          status_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          situacao?: string
          status_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cobranca_situacao_mapping_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "crm_cobranca_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cobranca_status_checklist: {
        Row: {
          created_at: string
          id: string
          label: string
          position: number
          status_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          position?: number
          status_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          position?: number
          status_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cobranca_status_checklist_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "crm_cobranca_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cobranca_statuses: {
        Row: {
          color: string
          created_at: string
          financeiro_visible: boolean
          id: string
          key: string
          label: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string
          financeiro_visible?: boolean
          id?: string
          key: string
          label: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string
          financeiro_visible?: boolean
          id?: string
          key?: string
          label?: string
          position?: number
        }
        Relationships: []
      }
      crm_cobrancas: {
        Row: {
          assigned_to: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          data: Json
          dias_atraso: number | null
          id: string
          scheduled_date: string | null
          ssotica_cliente_id: number | null
          ssotica_company_id: string | null
          ssotica_parcela_id: number | null
          ssotica_titulo_id: number | null
          status: string
          updated_at: string
          valor: number
          vencimento: string | null
        }
        Insert: {
          assigned_to?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          dias_atraso?: number | null
          id?: string
          scheduled_date?: string | null
          ssotica_cliente_id?: number | null
          ssotica_company_id?: string | null
          ssotica_parcela_id?: number | null
          ssotica_titulo_id?: number | null
          status?: string
          updated_at?: string
          valor?: number
          vencimento?: string | null
        }
        Update: {
          assigned_to?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          dias_atraso?: number | null
          id?: string
          scheduled_date?: string | null
          ssotica_cliente_id?: number | null
          ssotica_company_id?: string | null
          ssotica_parcela_id?: number | null
          ssotica_titulo_id?: number | null
          status?: string
          updated_at?: string
          valor?: number
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_cobrancas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cobrancas_ssotica_company_id_fkey"
            columns: ["ssotica_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_columns: {
        Row: {
          created_at: string
          field_key: string
          field_type: string
          id: string
          is_required: boolean
          name: string
          options: Json | null
          position: number
        }
        Insert: {
          created_at?: string
          field_key: string
          field_type?: string
          id?: string
          is_required?: boolean
          name: string
          options?: Json | null
          position?: number
        }
        Update: {
          created_at?: string
          field_key?: string
          field_type?: string
          id?: string
          is_required?: boolean
          name?: string
          options?: Json | null
          position?: number
        }
        Relationships: []
      }
      crm_form_fields: {
        Row: {
          created_at: string
          date_status_ranges: Json | null
          field_type: string
          id: string
          is_name_field: boolean
          is_phone_field: boolean
          is_required: boolean
          label: string
          options: Json | null
          parent_field_id: string | null
          parent_trigger_value: string | null
          position: number
          show_on_card: boolean
          status_mapping: Json | null
        }
        Insert: {
          created_at?: string
          date_status_ranges?: Json | null
          field_type?: string
          id?: string
          is_name_field?: boolean
          is_phone_field?: boolean
          is_required?: boolean
          label: string
          options?: Json | null
          parent_field_id?: string | null
          parent_trigger_value?: string | null
          position?: number
          show_on_card?: boolean
          status_mapping?: Json | null
        }
        Update: {
          created_at?: string
          date_status_ranges?: Json | null
          field_type?: string
          id?: string
          is_name_field?: boolean
          is_phone_field?: boolean
          is_required?: boolean
          label?: string
          options?: Json | null
          parent_field_id?: string | null
          parent_trigger_value?: string | null
          position?: number
          show_on_card?: boolean
          status_mapping?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_form_fields_parent_field_id_fkey"
            columns: ["parent_field_id"]
            isOneToOne: false
            referencedRelation: "crm_form_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          lead_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          lead_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          lead_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          assigned_to: string | null
          comprou: boolean
          created_at: string
          created_by: string | null
          data: Json
          id: string
          scheduled_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          comprou?: boolean
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          scheduled_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          comprou?: boolean
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          scheduled_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_module_transition_logs: {
        Row: {
          cliente_nome: string
          company_id: string | null
          created_at: string
          from_module: string
          id: string
          source_record_id: string | null
          ssotica_cliente_id: number | null
          target_record_id: string | null
          to_module: string
          to_status_key: string | null
          to_status_label: string | null
          trigger_source: string
          triggered_by: string | null
        }
        Insert: {
          cliente_nome: string
          company_id?: string | null
          created_at?: string
          from_module: string
          id?: string
          source_record_id?: string | null
          ssotica_cliente_id?: number | null
          target_record_id?: string | null
          to_module: string
          to_status_key?: string | null
          to_status_label?: string | null
          trigger_source?: string
          triggered_by?: string | null
        }
        Update: {
          cliente_nome?: string
          company_id?: string | null
          created_at?: string
          from_module?: string
          id?: string
          source_record_id?: string | null
          ssotica_cliente_id?: number | null
          target_record_id?: string | null
          to_module?: string
          to_status_key?: string | null
          to_status_label?: string | null
          trigger_source?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_module_transition_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_renovacao_form_fields: {
        Row: {
          created_at: string
          date_status_ranges: Json | null
          field_type: string
          id: string
          is_cpf_field: boolean
          is_last_visit_field: boolean
          is_name_field: boolean
          is_phone_field: boolean
          is_required: boolean
          label: string
          options: Json | null
          parent_field_id: string | null
          parent_trigger_value: string | null
          position: number
          show_on_card: boolean
          status_mapping: Json | null
        }
        Insert: {
          created_at?: string
          date_status_ranges?: Json | null
          field_type?: string
          id?: string
          is_cpf_field?: boolean
          is_last_visit_field?: boolean
          is_name_field?: boolean
          is_phone_field?: boolean
          is_required?: boolean
          label: string
          options?: Json | null
          parent_field_id?: string | null
          parent_trigger_value?: string | null
          position?: number
          show_on_card?: boolean
          status_mapping?: Json | null
        }
        Update: {
          created_at?: string
          date_status_ranges?: Json | null
          field_type?: string
          id?: string
          is_cpf_field?: boolean
          is_last_visit_field?: boolean
          is_name_field?: boolean
          is_phone_field?: boolean
          is_required?: boolean
          label?: string
          options?: Json | null
          parent_field_id?: string | null
          parent_trigger_value?: string | null
          position?: number
          show_on_card?: boolean
          status_mapping?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_renovacao_form_fields_parent_field_id_fkey"
            columns: ["parent_field_id"]
            isOneToOne: false
            referencedRelation: "crm_renovacao_form_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_renovacao_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          renovacao_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          renovacao_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          renovacao_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_renovacao_notes_renovacao_id_fkey"
            columns: ["renovacao_id"]
            isOneToOne: false
            referencedRelation: "crm_renovacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_renovacao_statuses: {
        Row: {
          color: string
          created_at: string
          id: string
          key: string
          label: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          key: string
          label: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          key?: string
          label?: string
          position?: number
        }
        Relationships: []
      }
      crm_renovacoes: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          data: Json
          data_ultima_compra: string | null
          id: string
          scheduled_date: string | null
          ssotica_cliente_id: number | null
          ssotica_company_id: string | null
          ssotica_venda_id: number | null
          status: string
          updated_at: string
          valor: number
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          data_ultima_compra?: string | null
          id?: string
          scheduled_date?: string | null
          ssotica_cliente_id?: number | null
          ssotica_company_id?: string | null
          ssotica_venda_id?: number | null
          status?: string
          updated_at?: string
          valor?: number
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          data_ultima_compra?: string | null
          id?: string
          scheduled_date?: string | null
          ssotica_cliente_id?: number | null
          ssotica_company_id?: string | null
          ssotica_venda_id?: number | null
          status?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_renovacoes_ssotica_company_id_fkey"
            columns: ["ssotica_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_statuses: {
        Row: {
          color: string
          created_at: string
          id: string
          key: string
          label: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          key: string
          label: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          key?: string
          label?: string
          position?: number
        }
        Relationships: []
      }
      lead_activities: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          lead_id: string
          scheduled_date: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          lead_id: string
          scheduled_date: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          lead_id?: string
          scheduled_date?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_card_opens: {
        Row: {
          card_type: string
          cobranca_id: string | null
          id: string
          lead_id: string | null
          opened_at: string
          renovacao_id: string | null
          user_id: string
        }
        Insert: {
          card_type: string
          cobranca_id?: string | null
          id?: string
          lead_id?: string | null
          opened_at?: string
          renovacao_id?: string | null
          user_id: string
        }
        Update: {
          card_type?: string
          cobranca_id?: string | null
          id?: string
          lead_id?: string | null
          opened_at?: string
          renovacao_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      manager_companies: {
        Row: {
          company_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          lead_id: string | null
          message: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          lead_id?: string | null
          message: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          lead_id?: string | null
          message?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      renovacao_activities: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          renovacao_id: string
          scheduled_date: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          renovacao_id: string
          scheduled_date: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          renovacao_id?: string
          scheduled_date?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "renovacao_activities_renovacao_id_fkey"
            columns: ["renovacao_id"]
            isOneToOne: false
            referencedRelation: "crm_renovacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_whatsapp_messages: {
        Row: {
          created_at: string
          created_by: string
          error_message: string | null
          id: string
          lead_id: string | null
          message: string
          phone: string
          scheduled_at: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          error_message?: string | null
          id?: string
          lead_id?: string | null
          message: string
          phone: string
          scheduled_at: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          lead_id?: string | null
          message?: string
          phone?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      ssotica_funcionarios: {
        Row: {
          company_id: string
          created_at: string
          funcao: string | null
          id: string
          last_seen_at: string
          nome: string
          ssotica_funcionario_id: number
        }
        Insert: {
          company_id: string
          created_at?: string
          funcao?: string | null
          id?: string
          last_seen_at?: string
          nome: string
          ssotica_funcionario_id: number
        }
        Update: {
          company_id?: string
          created_at?: string
          funcao?: string | null
          id?: string
          last_seen_at?: string
          nome?: string
          ssotica_funcionario_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ssotica_funcionarios_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ssotica_integrations: {
        Row: {
          backfill_chunk_index: number
          backfill_next_run_at: string | null
          backfill_phase: string
          backfill_scope: string
          backfill_started_at: string | null
          backfill_status: string
          backfill_total_chunks: number
          bearer_token: string
          cnpj: string
          company_id: string
          created_at: string
          id: string
          initial_sync_done: boolean
          is_active: boolean
          last_error: string | null
          last_sync_receber_at: string | null
          last_sync_vendas_at: string | null
          license_code: string | null
          sync_status: string
          updated_at: string
        }
        Insert: {
          backfill_chunk_index?: number
          backfill_next_run_at?: string | null
          backfill_phase?: string
          backfill_scope?: string
          backfill_started_at?: string | null
          backfill_status?: string
          backfill_total_chunks?: number
          bearer_token: string
          cnpj: string
          company_id: string
          created_at?: string
          id?: string
          initial_sync_done?: boolean
          is_active?: boolean
          last_error?: string | null
          last_sync_receber_at?: string | null
          last_sync_vendas_at?: string | null
          license_code?: string | null
          sync_status?: string
          updated_at?: string
        }
        Update: {
          backfill_chunk_index?: number
          backfill_next_run_at?: string | null
          backfill_phase?: string
          backfill_scope?: string
          backfill_started_at?: string | null
          backfill_status?: string
          backfill_total_chunks?: number
          bearer_token?: string
          cnpj?: string
          company_id?: string
          created_at?: string
          id?: string
          initial_sync_done?: boolean
          is_active?: boolean
          last_error?: string | null
          last_sync_receber_at?: string | null
          last_sync_vendas_at?: string | null
          license_code?: string | null
          sync_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ssotica_integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ssotica_sync_logs: {
        Row: {
          details: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          integration_id: string
          items_created: number
          items_processed: number
          items_updated: number
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          integration_id: string
          items_created?: number
          items_processed?: number
          items_updated?: number
          started_at?: string
          status?: string
          sync_type: string
        }
        Update: {
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          integration_id?: string
          items_created?: number
          items_processed?: number
          items_updated?: number
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ssotica_sync_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "ssotica_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      ssotica_user_mappings: {
        Row: {
          company_id: string
          created_at: string
          id: string
          ssotica_funcionario_id: number
          ssotica_funcionario_nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          ssotica_funcionario_id: number
          ssotica_funcionario_nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          ssotica_funcionario_id?: number
          ssotica_funcionario_nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ssotica_user_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          id: string
          setting_key: string
          setting_value: string
          updated_at: string
        }
        Insert: {
          id?: string
          setting_key: string
          setting_value: string
          updated_at?: string
        }
        Update: {
          id?: string
          setting_key?: string
          setting_value?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_campaign_sends: {
        Row: {
          campaign_id: string
          created_at: string
          error_message: string | null
          id: string
          lead_id: string
          phone: string
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id: string
          phone: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string
          phone?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaign_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_campaigns: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string
          end_date: string
          end_time: string
          id: string
          image_url: string | null
          instance_id: string | null
          is_active: boolean
          message: string
          module: string
          name: string
          start_date: string
          start_time: string
          status_id: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by: string
          end_date: string
          end_time?: string
          id?: string
          image_url?: string | null
          instance_id?: string | null
          is_active?: boolean
          message: string
          module?: string
          name: string
          start_date: string
          start_time?: string
          status_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string
          end_date?: string
          end_time?: string
          id?: string
          image_url?: string | null
          instance_id?: string | null
          is_active?: boolean
          message?: string
          module?: string
          name?: string
          start_date?: string
          start_time?: string
          status_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaigns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaigns_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_completion_logs: {
        Row: {
          company_id: string | null
          completed_at: string
          created_at: string
          error_count: number
          id: string
          module: string
          sent_count: number
          source_id: string
          source_name: string
          source_type: string
          status_id: string | null
          status_key: string | null
          status_label: string | null
          total_cards: number
        }
        Insert: {
          company_id?: string | null
          completed_at?: string
          created_at?: string
          error_count?: number
          id?: string
          module: string
          sent_count?: number
          source_id: string
          source_name: string
          source_type: string
          status_id?: string | null
          status_key?: string | null
          status_label?: string | null
          total_cards?: number
        }
        Update: {
          company_id?: string | null
          completed_at?: string
          created_at?: string
          error_count?: number
          id?: string
          module?: string
          sent_count?: number
          source_id?: string
          source_name?: string
          source_type?: string
          status_id?: string | null
          status_key?: string | null
          status_label?: string | null
          total_cards?: number
        }
        Relationships: []
      }
      whatsapp_instances: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          session: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          session: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          session?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_trigger_campaigns: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string
          end_time: string
          id: string
          instance_id: string | null
          instance_ids: Json
          is_active: boolean
          module: string
          name: string
          start_time: string
          status_id: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by: string
          end_time?: string
          id?: string
          instance_id?: string | null
          instance_ids?: Json
          is_active?: boolean
          module?: string
          name: string
          start_time?: string
          status_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string
          end_time?: string
          id?: string
          instance_id?: string | null
          instance_ids?: Json
          is_active?: boolean
          module?: string
          name?: string
          start_time?: string
          status_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_trigger_campaigns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_trigger_campaigns_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_trigger_sends: {
        Row: {
          campaign_id: string
          created_at: string
          error_message: string | null
          id: string
          lead_id: string
          phone: string
          sent_at: string | null
          status: string
          step_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id: string
          phone: string
          sent_at?: string | null
          status?: string
          step_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string
          phone?: string
          sent_at?: string | null
          status?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_trigger_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_trigger_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_trigger_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_trigger_sends_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_trigger_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_trigger_steps: {
        Row: {
          campaign_id: string
          created_at: string
          delay_days: number
          id: string
          image_url: string | null
          message: string
          position: number
        }
        Insert: {
          campaign_id: string
          created_at?: string
          delay_days?: number
          id?: string
          image_url?: string | null
          message: string
          position?: number
        }
        Update: {
          campaign_id?: string
          created_at?: string
          delay_days?: number
          id?: string
          image_url?: string | null
          message?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_trigger_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_trigger_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _export_auth_identities_full: {
        Args: never
        Returns: {
          created_at: string
          email: string
          identity_data: Json
          last_sign_in_at: string
          provider: string
          provider_id: string
          updated_at: string
          user_id: string
        }[]
      }
      _export_auth_password_hashes: {
        Args: never
        Returns: {
          confirmation_token: string
          email_change: string
          email_change_token_new: string
          encrypted_password: string
          id: string
          instance_id: string
          recovery_token: string
        }[]
      }
      _export_auth_users_full: {
        Args: never
        Returns: {
          aud: string
          confirmation_token: string
          created_at: string
          email: string
          email_change: string
          email_change_token_new: string
          email_confirmed_at: string
          encrypted_password: string
          id: string
          instance_id: string
          is_anonymous: boolean
          is_sso_user: boolean
          raw_app_meta_data: Json
          raw_user_meta_data: Json
          recovery_token: string
          role: string
          updated_at: string
        }[]
      }
      _get_encryption_key: { Args: never; Returns: string }
      admin_decrypt_license: {
        Args: { _integration_id: string }
        Returns: string
      }
      can_access_renovacao: {
        Args: { _renovacao_id: string }
        Returns: boolean
      }
      decrypt_secret: { Args: { _ciphertext: string }; Returns: string }
      delete_all_leads_cascade: { Args: never; Returns: Json }
      delete_duplicate_leads: { Args: { _lead_ids: string[] }; Returns: Json }
      encrypt_secret: { Args: { _plaintext: string }; Returns: string }
      find_lead_by_phone: {
        Args: { _phone: string }
        Returns: {
          is_mine: boolean
          lead_id: string
          owner_name: string
          owner_user_id: string
        }[]
      }
      get_company_user_ids: { Args: never; Returns: string[] }
      get_my_company_id: { Args: never; Returns: string }
      get_profile_names: {
        Args: never
        Returns: {
          avatar_url: string
          full_name: string
          user_id: string
        }[]
      }
      get_ssotica_credentials: {
        Args: { _integration_id: string }
        Returns: {
          backfill_chunk_index: number
          backfill_next_run_at: string
          backfill_started_at: string
          backfill_status: string
          backfill_total_chunks: number
          bearer_token: string
          cnpj: string
          company_id: string
          id: string
          initial_sync_done: boolean
          is_active: boolean
          last_sync_receber_at: string
          last_sync_vendas_at: string
          license_code: string
          sync_status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_my_company: { Args: { _company_id: string }; Returns: boolean }
      is_same_company: { Args: { _user_id: string }; Returns: boolean }
      manage_ssotica_cron: { Args: never; Returns: undefined }
      manage_whatsapp_cron: { Args: never; Returns: undefined }
      reclassify_cobrancas_by_situacao: { Args: never; Returns: number }
      slugify_status_key: { Args: { _label: string }; Returns: string }
      ssotica_enqueue_sync: {
        Args: {
          _auth: string
          _force_full?: boolean
          _integration_id: string
          _url: string
        }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "vendedor" | "gerente" | "financeiro"
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
    Enums: {
      app_role: ["admin", "vendedor", "gerente", "financeiro"],
    },
  },
} as const
