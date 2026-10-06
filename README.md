# Calculadora de Campanhas

Página única (`index.html`) com uma API na pasta `api/` que guarda campanhas, projetos e usuários num Redis.
Cada pessoa entra com o próprio usuário e senha.

## Arquivos

- `index.html`: a página.
- `api/campanhas.js`: campanhas, projetos e andamento.
- `api/auth.js`: login, logout e troca de senha.
- `api/usuarios.js`: administração de usuários (só administradores).
- `api/_lib.js`: utilidades compartilhadas (o `_` no nome é proposital).

Todos ficam no repositório com `index.html` na raiz e os quatro arquivos dentro da pasta `api`.

## Configurar no Vercel

1. **Banco:** em Storage, conecte o Upstash for Redis ao projeto. O Vercel cria as variáveis
   `KV_REST_API_URL` e `KV_REST_API_TOKEN` (a API aceita também `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`).
2. **`SESSION_SECRET`:** em Settings, Environment Variables, crie esta variável com um texto longo e aleatório
   (40 caracteres ou mais, misture letras, números e símbolos). Ela assina os logins. Não compartilhe.
3. **`APP_PASSWORD`:** a senha do primeiro acesso, explicada abaixo. Ela já existe se você a criou antes.
4. Faça um Redeploy, porque variáveis só valem em deploys novos.

## Primeiro acesso

1. Abra o site e entre com o usuário `admin` e a senha que está em `APP_PASSWORD`.
2. O sistema pede uma senha nova na hora. Depois disso, o `APP_PASSWORD` deixa de funcionar como login.
3. Abra **Configurações** (só administradores veem), crie seu usuário pessoal com perfil Administrador e o dos colegas.
4. Entre com o seu usuário novo e desative o usuário `admin`.

## Usuários

- Criar: informe usuário (letras minúsculas, números, ponto ou hífen), nome completo e perfil. Se deixar a senha
  em branco, o sistema gera uma. A senha temporária aparece uma única vez, para você enviar à pessoa.
- Quem entra com senha temporária troca por outra no primeiro acesso.
- Redefinir senha: gera outra temporária e derruba os logins anteriores da pessoa.
- Desativar: a pessoa perde o acesso na hora, e o histórico continua com o nome dela.
- Perfis: **Administrador** gerencia usuários e exclui itens de vez. **Usuário** cria, edita, arquiva e marca andamento.
- O nome que aparece como criador e autor das edições vem do login, não pode ser escolhido pela pessoa.

## Segurança

- Senhas guardadas com scrypt e sal individual. Nenhuma senha é salva em texto.
- Login por cookie assinado (HttpOnly, SameSite, 7 dias). Requisições que alteram dados exigem cabeçalho próprio.
- Bloqueio de 15 minutos após 5 tentativas erradas para o mesmo usuário e endereço.
- Sempre sirva o site por HTTPS (o Vercel já faz isso).

## Como funciona

- A aba **Andamento** lista campanhas e projetos com um checklist gerado pela calculadora. Cada marcação guarda quem
  marcou e quando. "Marcar como publicada hoje" atualiza o status e a data real no histórico.
- A aba **Histórico** guarda tudo, com previsto x real, arquivamento e atividade recente.
- Cada campanha gera o resumo interno, a mensagem para Produto, os cards do Trello e o contexto para o Claude.

## Sem o servidor

Sem a API, o banco ou o `SESSION_SECRET`, a página funciona em modo local: salva só no navegador de quem usa e avisa
isso na barra do topo.

## Ajustar regras e listas

Faixas de pontos, prazos, briefings e as listas de pessoas ficam no início do script de `index.html`
(`CFG`, `BRIEF`, `PESSOAS` e `PROJ`).
