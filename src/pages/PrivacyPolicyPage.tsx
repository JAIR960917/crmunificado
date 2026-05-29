/**
 * Política de Privacidade — URL pública exigida na revisão do app Meta / WhatsApp Business.
 */
export default function PrivacyPolicyPage() {
  const site = typeof window !== "undefined" ? window.location.origin : "https://crm.joonker.com.br";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10 prose prose-sm dark:prose-invert">
        <h1>Política de Privacidade — CRM MyWay</h1>
        <p className="text-muted-foreground">Última atualização: maio de 2026</p>

        <h2>1. Quem somos</h2>
        <p>
          O CRM MyWay é um sistema de gestão de relacionamento com clientes (CRM) utilizado por empresas
          do varejo óptico para organizar leads, cobranças, renovações e comunicação com clientes,
          incluindo mensagens pelo WhatsApp Business API quando autorizado pelo titular.
        </p>

        <h2>2. Dados que coletamos</h2>
        <ul>
          <li>Dados de cadastro de usuários do sistema (nome, e-mail, empresa).</li>
          <li>Dados de clientes e leads inseridos pela empresa (nome, telefone, histórico comercial).</li>
          <li>Registros de mensagens enviadas e recebidas via WhatsApp Business API, quando o recurso estiver ativo.</li>
          <li>Logs técnicos de envio e entrega para auditoria e suporte.</li>
        </ul>

        <h2>3. Finalidade do uso</h2>
        <p>
          Os dados são usados exclusivamente para operação do CRM: atendimento, cobrança, renovação de contratos,
          campanhas autorizadas e cumprimento de obrigações contratuais entre a empresa usuária e seus clientes.
        </p>

        <h2>4. WhatsApp e Meta</h2>
        <p>
          Quando a integração oficial com a Meta (WhatsApp Cloud API) estiver habilitada, o processamento de
          mensagens segue as políticas da Meta Platforms e do WhatsApp Business. Não vendemos dados a terceiros
          para marketing externo.
        </p>

        <h2>5. Compartilhamento</h2>
        <p>
          Dados podem ser processados em provedores de infraestrutura (hospedagem, banco de dados) sob contrato
          de confidencialidade. Mensagens WhatsApp transitam pelos servidores da Meta conforme sua política.
        </p>

        <h2>6. Retenção e segurança</h2>
        <p>
          Mantemos os dados enquanto a conta da empresa estiver ativa ou conforme exigência legal.
          Aplicamos controle de acesso por perfil (admin, gerente, vendedor) e comunicação criptografada (HTTPS).
        </p>

        <h2>7. Direitos do titular</h2>
        <p>
          O titular dos dados pessoais pode solicitar acesso, correção ou exclusão entrando em contato com a
          empresa que o cadastrou no CRM ou pelo canal indicado em{" "}
          <a href={`${site}/exclusao-dados`}>Solicitação de exclusão de dados</a>.
        </p>

        <h2>8. Contato</h2>
        <p>
          Para dúvidas sobre esta política, utilize o canal de suporte da sua empresa ou o administrador
          do sistema CRM MyWay na sua organização.
        </p>
      </div>
    </div>
  );
}
