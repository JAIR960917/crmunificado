# Guia: submissão Meta / WhatsApp Cloud API — CRM MyWay

Este documento descreve como preparar o CRM para **revisão do app na Meta** e migrar do **API Full** para a **API oficial do WhatsApp (Cloud API)**, reduzindo risco de banimento de números.

## O que já está no sistema

| Recurso | Local |
|--------|--------|
| Envio unificado (API Full ou Meta) | `supabase/functions/_shared/whatsappSend.ts` |
| Webhook Meta (mensagens + janela 24h) | `supabase/functions/whatsapp-webhook` |
| Painel admin Meta | WhatsApp → aba **API Meta** |
| Demo do inbox (gravação para revisão) | `/whatsapp-inbox-demo` |
| Política de privacidade | `https://SEU_DOMINIO/privacidade` |
| Termos de uso | `https://SEU_DOMINIO/termos` |
| Exclusão de dados | `https://SEU_DOMINIO/exclusao-dados` |
| Tabelas inbox / opt-in | migration `20260529180000_whatsapp_meta_cloud_api.sql` |

## 1. Conta Meta e WhatsApp Business

1. Crie app em [Meta for Developers](https://developers.facebook.com/).
2. Adicione produto **WhatsApp**.
3. Vincule uma **WhatsApp Business Account (WABA)** e um número de telefone comercial.
4. Conclua verificação comercial da empresa, se solicitado.

## 2. Variáveis de ambiente (VPS `.env`)

```env
# Token permanente (System User) com permissões whatsapp_business_messaging, whatsapp_business_management
WHATSAPP_ACCESS_TOKEN=

# Mesmo valor cadastrado no webhook do app Meta
WHATSAPP_VERIFY_TOKEN=

# App Secret (Configurações básicas do app) — valida assinatura do webhook
WHATSAPP_APP_SECRET=

# ID da conta WABA (WhatsApp → API Setup)
WHATSAPP_WABA_ID=
```

Reinicie os containers das edge functions após alterar o `.env`:

```bash
docker compose restart supabase-edge-functions
```

## 3. Webhook

1. No app Meta: **WhatsApp → Configuration → Webhook**.
2. **Callback URL**: `https://api.SEU_DOMINIO/functions/v1/whatsapp-webhook`
3. **Verify token**: igual a `WHATSAPP_VERIFY_TOKEN`.
4. Assine os campos: `messages` (e opcionalmente `message_template_status_update`).
5. No painel CRM (**WhatsApp → API Meta**), confira se a URL exibida bate com a pública (`SUPABASE_PUBLIC_URL`).
6. O webhook **não exige JWT** (exceção em `supabase/functions/main/index.ts` → `whatsapp-webhook`).
7. **Mensagens reais do celular não chegam?** O botão «Teste» da Meta só valida conectividade. É obrigatório **inscrever a WABA no app**:
   - No CRM: **Diagnosticar webhook** → **Inscrever WABA no webhook**, ou
   - Graph API: `POST https://graph.facebook.com/v21.0/{WABA_ID}/subscribed_apps` com o token do sistema.
8. Confirme que o número comercial está **CONNECTED** (diagnóstico no painel CRM).
9. App em **desenvolvimento**: cadastre os números pessoais que vão testar em **WhatsApp → API Setup** (destinatários de teste).

## 4. Cadastrar número no CRM

1. **WhatsApp → API Meta → Adicionar número Meta**
2. Informe **Phone Number ID** (painel Meta → API Setup).
3. Defina **template padrão** para envios fora da janela de 24h.
4. Em campanhas/gatilhos, preencha **Template Meta** com o nome exato do template aprovado (categoria Utility/Marketing conforme o caso).

## 5. Templates de mensagem

Fora da janela de 24h só é permitido enviar **templates aprovados**.

1. Crie templates no **WhatsApp Manager** (corpo com variáveis `{{1}}`, `{{2}}`…).
2. Aguarde status **APPROVED**.
3. Use **Listar templates aprovados** no painel CRM para conferir nomes.
4. Em cobrança, prefira categoria **UTILITY** com texto claro (lembrete de parcela, não promocional abusivo).

## 6. Migrar do API Full para Meta

1. Mantenha `whatsapp_provider = apifull` até o webhook e um envio de teste funcionarem.
2. Cadastre instâncias `provider = meta` (não apague as da API Full até validar).
3. Teste envio manual com template para um número de teste.
4. No painel, altere **Modo de envio** para **Meta Cloud API**.
5. Redirecione campanhas para instâncias Meta e preencha `meta_template_name` onde necessário.

## 7. Submissão para revisão (App Review)

Informe na submissão:

- **Use case**: CRM para óticas — atendimento de leads, lembretes de cobrança e renovação via WhatsApp Business API com consentimento do cliente.
- **Permissões típicas**: `whatsapp_business_messaging`, `whatsapp_business_management`.
- **URLs obrigatórias**:
  - Privacy Policy: `https://crm.SEU_DOMINIO/privacidade`
  - Terms: `https://crm.SEU_DOMINIO/termos`
  - Data deletion: `https://crm.SEU_DOMINIO/exclusao-dados`
- **Vídeo de demonstração** (2–3 min):
  1. Login no CRM.
  2. Tela **WhatsApp → API Meta** com webhook configurado.
  3. Tela **Inbox WhatsApp (demo)** ou conversa real após webhook.
  4. Envio de template ou resposta dentro da janela 24h.
  5. Vínculo com card de lead/cobrança (contexto CRM).

## 8. Boas práticas anti-banimento

- Respeite opt-in: só contate quem tem relação comercial ou consentiu.
- Use templates fora de 24h; evite texto livre em cold outreach.
- Mantenha intervalo entre envios (`whatsapp_send_delay_seconds` nas configurações).
- Monitore qualidade da conta no WhatsApp Manager (rating, blocks).
- Não use API não oficial (API Full) em paralelo no mesmo número oficial.

## 9. Deploy

```bash
./deploy.sh          # migrations + edge functions
```

Confirme que as functions `whatsapp-webhook` e `meta-whatsapp` aparecem no volume de edge functions da VPS.

## 10. Checklist rápido

- [ ] App Meta criado e WhatsApp adicionado
- [ ] WABA + número verificado
- [ ] `.env` com os 4 segredos WhatsApp
- [ ] Webhook verificado (challenge OK)
- [ ] Instância Meta cadastrada no CRM
- [ ] Pelo menos 1 template APPROVED
- [ ] Envio de teste OK
- [ ] URLs públicas de privacidade/termos/exclusão acessíveis
- [ ] Vídeo de demonstração gravado
- [ ] App Review enviado
- [ ] `whatsapp_provider` alterado para `meta` após aprovação
