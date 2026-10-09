# Market Simulation Server

Servidor Node.js independente que gera preços simulados e os disponibiliza por HTTP. Não importa código do projeto do bot e pode ser movido para outro diretório ou repositório.

## Instalação e execução

Requer Node.js 20 ou superior.

```powershell
npm install
npm run start
```

Durante o desenvolvimento, `npm run dev` reinicia o servidor quando o código muda. No Windows, `start.cmd` inicia o processo.

Ao iniciar o servidor, acesse `http://localhost:3001/` para abrir o cliente web de teste. Ele acompanha o preço e as ordens públicas, permite criar/conectar uma carteira e enviar compras e vendas simuladas. A chave informada fica em `sessionStorage` e é removida ao encerrar a sessão do navegador ou desconectar a carteira.

Veja a [descrição dos arquivos JSON de dados](docs/arquivos-de-dados.md) para consultar a finalidade e o formato de armazenamento de cada coleção.

Use o cliente apenas em ambiente local ou confiável; não informe chaves em uma instalação pública. Em produção, não armazene chaves de API em aplicações web: use um backend próprio com controles de acesso adequados.

### Docker e persistência

Para iniciar com Docker Compose:

```powershell
docker compose up -d --build
```

O Compose monta `./data` do host em `/app/data` no container e armazena os dados na estrutura modular em arquivos JSON (`data/accounts.json`, `data/assets.json`, `data/portfolios.json`, `data/orders.json`, `data/trades.json`, `data/market-history.json`, `data/market-events.json` e `data/market-state.json`). Esses arquivos contêm contas, posições de custódia, ordens, trades, preço atual, eventos e volumes, permanecendo disponíveis ao reiniciar ou recriar o container.

Confira as contas persistidas no host com:

```powershell
node -e "const s = require('./data/accounts.json'); console.log(s.length)"
```

Para executar a suíte de testes de consistência financeira e concorrência:

```powershell
npm test
```

Para rodar ou verificar a migração de banco de dados modular:

```powershell
npm run migrate
```

A chave de API em texto puro não é salva no arquivo, então cada usuário precisa guardar a chave recebida ao criar a conta. Rode apenas uma instância do serviço usando esses arquivos; sincronizar ou compartilhar os mesmos arquivos entre instâncias ativas pode causar sobrescrita de estado.

Por padrão, a API escuta na porta `3001` e os dados ficam na pasta `data/`, dentro deste projeto. Configure `MARKET_PORT` para trocar a porta ou `MARKET_STATE_FILE` para apontar o arquivo de estado principal.

Eventos simulados movimentam o preço em intervalos aleatórios de 60 a 120 segundos. Configure `MARKET_EVENT_MIN_INTERVAL_MS` e `MARKET_EVENT_MAX_INTERVAL_MS` para alterar os limites em milissegundos. Se o máximo for menor que o mínimo, o mínimo será usado como os dois limites. Os modelos, descrições e faixas de impacto são editáveis em `src/config/market-events.json`; cada categoria tem cenários positivos e negativos equilibrados para não criar tendência estrutural de queda.

Se estiver atrás de um reverse proxy confiável, configure `TRUST_PROXY` com o endereço ou faixa desse proxy, por exemplo `loopback` para um proxy local. Não use `true` indiscriminadamente: o endereço IP é usado nos limites de requisição.

Ao ser executado pela primeira vez ou a partir da estrutura antiga monolítica, o servidor migra automaticamente o estado existente para a nova estrutura modular em 8 arquivos JSON, mantendo backups de segurança em `data/backups/`.

## Logs

O servidor escreve logs estruturados em JSON no console do processo, um evento por linha. Registra requisições HTTP com método, caminho, status e duração, além de eventos de mercado, ordens, ciclo de contas e operações de persistência. Erros são enviados ao `stderr`; os demais níveis vão para `stdout`. Query strings, corpos das requisições e cabeçalhos de autenticação não são registrados, portanto chaves de API não aparecem nos logs.

## API

`GET /api/market/status` é público. Retorna preço, sequência, histórico recente, volume e as ordens públicas recentes, sem expor dados de contas.

`GET /api/backup` baixa um snapshot em JSON do estado atual do mercado, incluindo contas, saldo, histórico, trades públicos e os metadados de identificação (accountId e username). Use esse arquivo para auditoria, backup e recuperação do estado.

O arquivo inclui as oito coleções persistidas: contas, ativos, carteiras, ordens, negociações, histórico de preços, eventos e estado operacional. Ao restaurar, todas elas são substituídas pelo conteúdo do backup; nenhum registro posterior é mesclado ou preservado. A aplicação salva um backup de segurança antes da substituição.

`POST /api/backup/restore` exige `Authorization: Bearer <token-administrador>`. Em cada inicialização, o servidor cria ou atualiza uma conta administrativa de sistema separada das contas admin pessoais, imprime um token válido no terminal e persiste somente seu hash. Sem `MARKET_ADMIN_TOKEN`, a chave dessa conta de sistema é rotacionada a cada início; defina essa variável no ambiente se precisar de uma chave estável entre reinicializações.

```json
{
  "success": true,
  "data": {
    "currentPrice": 100.25,
    "sequence": 42,
    "updatedAt": "2026-10-07T21:00:00.000Z",
    "latestEvent": {
      "category": "Inflação",
      "title": "Inflação desacelera",
      "description": "Alívio inflacionário melhora o apetite por risco.",
      "impactPercent": 0.52,
      "occurredAt": "2026-10-07T20:59:00.000Z"
    },
    "nextEventAt": "2026-10-07T21:00:30.000Z",
    "volume": { "total": 100, "buys": 100, "sells": 0 },
    "recentTrades": [],
    "history": [
      { "sequence": 42, "price": 100.25, "updatedAt": "2026-10-07T21:00:00.000Z" }
    ]
  }
}
```

### Contas e ordens

`POST /api/accounts` cria uma carteira virtual com US$ 1.000 e retorna uma chave de API aleat?ria. A chave aparece apenas nessa resposta; o servidor guarda somente seu hash. Cada usu?rio deve criar e proteger sua pr?pria chave. O `username` ? obrigat?rio: use 3 a 24 caracteres, sem espa?os, apenas letras, n?meros, ponto, underline e h?fen.

Exemplo de cria??o com identificador:

```json
{ "username": "alice_trader" }
```

`GET /api/account` e `GET /api/account/history` exigem `Authorization: Bearer <API_KEY>`. A resposta inclui `accountId` e `username` para auditoria; os itens de hist?rico e de trades p?blicos tamb?m exibem essa identifica??o.

`POST /api/account/rotate-key` revoga a chave atual e devolve uma nova, exibida somente uma vez.

### Administração de usuários

Administradores autenticados podem gerenciar contas no painel em `/admin.html`. As rotas administrativas também aceitam `Authorization: Bearer <API_KEY>` de um administrador:

- `GET /api/admin/accounts` lista as contas sem expor hashes ou chaves de API.
- `POST /api/admin/accounts` cria uma conta com `{ "username": "novo_usuario", "isAdmin": true }`; a chave é retornada somente nessa resposta.
- `PATCH /api/admin/accounts/:accountId` altera `username` e/ou `isAdmin`.
- `DELETE /api/admin/accounts/:accountId` remove a conta e suas negociações.

O painel impede que um administrador remova seu próprio acesso, que exclua a própria conta ou que deixe o sistema sem administradores.

`POST /api/orders` tamb?m exige essa autentica??o. Compra usa valor em d?lares; venda usa unidades do ativo:

```json
{ "side": "BUY", "quoteAmount": 100 }
```

```json
{ "side": "SELL", "assetAmount": 0.5 }
```

Cada participante deve guardar sua chave e usar sua própria carteira. Não compartilhe uma chave entre usuários.

Uma compra pressiona o preço global para cima; uma venda, para baixo. O efeito é limitado a 2% por ordem, calculado sobre uma liquidez de referência de US$ 1.000, e o tamanho máximo é US$ 5.000 por ordem. Além das ordens de usuários e bots enviadas por essa API, eventos simulados de inflação, guerra, política, juros, tecnologia e emprego aplicam choques periódicos positivos ou negativos ao preço. O status público informa o último evento e a previsão do próximo. Esses cenários são aleatórios e não representam notícias ou dados do mundo real. O preço, os eventos, as contas, o volume e o histórico de ordens são persistidos neste servidor.

O cadastro está limitado a 5 chamadas por IP por hora; ordens, a 60 por IP por minuto e 20 por conta por minuto; rotação, a 3 por IP por hora. O servidor deve rodar como uma única autoridade de mercado; várias instâncias com arquivos locais separados não compartilham preço nem saldos.

Os limites usam armazenamento em memória e reiniciam quando o processo reinicia. Para alto volume ou múltiplas instâncias, migre contas, ordens, preço e limites para um banco compartilhado antes de escalar.

Clientes podem consultar essa rota sem conta ou chave. Se o servidor estiver em outra máquina, use a URL pública HTTPS e libere somente a porta necessária no firewall.
Qualquer cliente pode usar essas rotas com sua própria conta e chave Bearer. Não embuta a chave em código público de navegador, URLs ou repositórios; aplicações web devem intermediar ordens por um backend protegido. A integração para o bot automatizar ordens fica para outra etapa. Ao publicar na internet, use HTTPS.

Este serviço é paper trading; não se conecta a uma bolsa ou corretora real.

Este serviço é um simulador aleatório para paper trading; não se conecta a uma bolsa ou corretora real.
