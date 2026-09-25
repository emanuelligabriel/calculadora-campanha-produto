# Calculadora de Campanhas

Página única (`index.html`) com uma API (`api/campanhas.js`) que guarda as campanhas num Redis.
Quem tiver o link e a senha vê e edita as mesmas campanhas.

## Publicar no Vercel

1. Coloque esta pasta num repositório do GitHub e importe no Vercel (Add New, Project). Framework: Other.
   Alternativa: dentro da pasta, rode `npx vercel`.
2. No projeto, abra **Storage**, escolha **Upstash for Redis** no Marketplace, crie o banco (o plano gratuito basta)
   e conecte ao projeto. O Vercel cria as variáveis de ambiente sozinho.
3. Em **Settings, Environment Variables**, confira se existem `KV_REST_API_URL` e `KV_REST_API_TOKEN`
   (ou `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`). A API aceita os dois pares.
4. Ainda em Environment Variables, crie `APP_PASSWORD` com a senha da equipe.
5. Faça um novo deploy (Deployments, menu do último deploy, Redeploy). Variáveis só valem em deploys novos.
6. Abra o site. A barra no topo deve dizer "Salvamento compartilhado ativo."

## Como funciona

- A aba **Histórico** guarda tudo o que passou pela calculadora: campanhas, projetos e urgências, com status,
  prazo previsto x real, quem editou e quando. Itens arquivados saem da lista, mas continuam guardados e podem ser
  restaurados. "Excluir de vez" só aparece para itens arquivados. "Copiar para planilha" cola direto no Google Sheets ou Excel.
- Cada campanha gera o resumo interno, a mensagem para Produto, os cards do Trello (principal e do Design) e o
  contexto para colar numa conversa com o Claude.
- A campanha é salva sozinha assim que tem nome, e a cada edição.
- Cada campanha tem link próprio (botão "Copiar link"). Quem abrir o link entra direto nela.
- Se duas pessoas editarem a mesma campanha, a segunda a salvar vê um aviso e escolhe entre ver a versão da outra
  pessoa ou salvar a sua por cima.
- Remover pede uma segunda confirmação no botão.
- No navegador ficam guardados só a senha e o nome de quem edita. As campanhas ficam no Redis.

## Segurança

- Sem `APP_PASSWORD`, qualquer pessoa com o link pode ver e editar. A página avisa isso na barra do topo.
- A senha é uma só para a equipe toda. Para trocar, mude a variável e faça um novo deploy.
- O Vercel também tem proteção de deploy nas configurações do projeto, que pode ser usada junto com a senha.

## Sem o banco

Se a API ou o banco não estiverem configurados, a página funciona em modo local: salva só no navegador de quem usa,
e avisa isso na barra do topo.

## Ajustar regras

Faixas de pontos, prazos e campos de briefing ficam no objeto `CFG` e na constante `BRIEF`, no início do script de `index.html`.
