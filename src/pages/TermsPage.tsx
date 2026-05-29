/**
 * Termos de Uso — URL pública para revisão Meta / WhatsApp Business.
 */
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10 prose prose-sm dark:prose-invert">
        <h1>Termos de Uso — CRM MyWay</h1>
        <p className="text-muted-foreground">Última atualização: maio de 2026</p>

        <h2>1. Aceite</h2>
        <p>
          Ao acessar o CRM MyWay, o usuário declara ter lido e aceito estes termos em nome da empresa
          contratante do serviço.
        </p>

        <h2>2. Serviço</h2>
        <p>
          O CRM MyWay oferece ferramentas de gestão de leads, kanban, cobranças, relatórios e, opcionalmente,
          envio de mensagens via WhatsApp Business API após configuração e aprovação junto à Meta.
        </p>

        <h2>3. Responsabilidades da empresa usuária</h2>
        <ul>
          <li>Garantir base legal e consentimento para contato dos clientes (LGPD e políticas WhatsApp).</li>
          <li>Utilizar apenas templates aprovados pela Meta para mensagens fora da janela de 24 horas.</li>
          <li>Não enviar spam, conteúdo proibido ou mensagens em massa não solicitadas.</li>
          <li>Manter credenciais e acessos de administradores em sigilo.</li>
        </ul>

        <h2>4. Uso do WhatsApp</h2>
        <p>
          O uso da API oficial do WhatsApp está sujeito aos Termos de Serviço do WhatsApp Business e às
          políticas da Meta. Banimentos ou limitações impostas pela Meta por violação de política são de
          responsabilidade da conta Business vinculada.
        </p>

        <h2>5. Disponibilidade</h2>
        <p>
          Empregamos esforços razoáveis para manter o sistema disponível, sem garantia de uptime ininterrupto.
          Manutenções programadas podem ser comunicadas aos administradores.
        </p>

        <h2>6. Limitação</h2>
        <p>
          O software é fornecido &quot;como está&quot;, dentro dos limites permitidos pela lei aplicável.
          Danos indiretos decorrentes de mau uso ou de terceiros (incluindo Meta) não são indenizáveis pelo
          provedor do CRM além do acordado contratualmente com a empresa cliente.
        </p>

        <h2>7. Alterações</h2>
        <p>
          Estes termos podem ser atualizados. O uso continuado após publicação da nova versão constitui aceite.
        </p>
      </div>
    </div>
  );
}
