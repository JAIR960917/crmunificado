/**
 * Instruções de exclusão de dados — exigido na revisão de apps Meta conectados ao WhatsApp.
 */
export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10 prose prose-sm dark:prose-invert">
        <h1>Exclusão de dados — CRM MyWay</h1>
        <p className="text-muted-foreground">Última atualização: maio de 2026</p>

        <h2>Como solicitar a exclusão</h2>
        <p>
          Se você é cliente final de uma ótica que usa o CRM MyWay e deseja que seus dados pessoais
          sejam removidos:
        </p>
        <ol>
          <li>
            Entre em contato diretamente com a empresa (ótica) que possui seus dados — ela é a
            controladora dos dados no CRM.
          </li>
          <li>
            Se não souber o contato, envie e-mail ao administrador do CRM da empresa informando nome
            completo e telefone cadastrado.
          </li>
          <li>
            A empresa usuária do CRM deverá excluir ou anonimizar o cadastro nas telas de Leads,
            Cobranças ou Renovação, conforme o módulo onde você aparece.
          </li>
        </ol>

        <h2>Dados no WhatsApp</h2>
        <p>
          Mensagens trocadas pelo WhatsApp Business são também regidas pelas ferramentas da Meta.
          A exclusão no CRM remove histórico armazenado no nosso banco; conversas no aplicativo WhatsApp
          do usuário podem permanecer no dispositivo dele conforme política da Meta.
        </p>

        <h2>Prazo</h2>
        <p>
          Pedidos legítimos devem ser atendidos em até 30 dias, salvo obrigação legal de retenção
          (ex.: registros fiscais).
        </p>

        <h2>Callback Meta (desenvolvedores)</h2>
        <p>
          Para exclusão vinculada a conta Meta/WhatsApp Business configurada neste app, o administrador
          pode registrar a URL de callback de exclusão de dados no painel Meta for Developers apontando
          para o endpoint configurado pela equipe técnica do CRM (consulte a documentação interna
          <code>docs/META_APP_REVIEW.md</code>).
        </p>
      </div>
    </div>
  );
}
