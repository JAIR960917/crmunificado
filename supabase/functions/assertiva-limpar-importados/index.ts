import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "contratos-assertiva";

async function requireAdminDev(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Response(JSON.stringify({ ok: false, error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u.user) throw new Response(JSON.stringify({ ok: false, error: "Sessão inválida" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: callerRoles } = await userClient.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = !!callerRoles?.some((r) => r.role === "admin" || r.role === "desenvolvedor");
  if (!allowed) throw new Response(JSON.stringify({ ok: false, error: "Apenas admin ou desenvolvedor" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function removeStoragePrefix(
  supa: ReturnType<typeof createClient>,
  prefix: string,
): Promise<number> {
  let removed = 0;
  const listPath = prefix || undefined;
  let offset = 0;

  for (;;) {
    const { data, error } = await supa.storage.from(BUCKET).list(listPath ?? "", {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    if (!data?.length) break;

    const filePaths: string[] = [];
    for (const item of data) {
      const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        removed += await removeStoragePrefix(supa, itemPath);
      } else {
        filePaths.push(itemPath);
      }
    }

    if (filePaths.length) {
      const { error: rmError } = await supa.storage.from(BUCKET).remove(filePaths);
      if (rmError) throw rmError;
      removed += filePaths.length;
    }

    if (data.length < 1000) break;
    offset += 1000;
  }

  return removed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    await requireAdminDev(req);

    const body = await req.json().catch(() => ({}));
    const confirm = body.confirm === true;
    if (!confirm) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Envie { "confirm": true } para confirmar a exclusão' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { count, error: countError } = await supa
      .from("crediario_contratos_assertiva")
      .select("id", { count: "exact", head: true });
    if (countError) throw countError;

    const arquivosRemovidos = await removeStoragePrefix(supa, "");

    const { error: deleteError } = await supa
      .from("crediario_contratos_assertiva")
      .delete()
      .gte("imported_at", "1970-01-01T00:00:00Z");
    if (deleteError) throw deleteError;

    return new Response(
      JSON.stringify({
        ok: true,
        registros_removidos: count ?? 0,
        arquivos_storage_removidos: arquivosRemovidos,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("assertiva-limpar-importados", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
