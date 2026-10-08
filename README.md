# Market Simulation Server

Servidor Node.js independente que gera preços simulados e os disponibiliza por HTTP. Não importa código do projeto do bot e pode ser movido para outro diretório ou repositório.

## Instalação e execução

Requer Node.js 20 ou superior.

```powershell
npm install
npm start
```

Durante o desenvolvimento, `npm run dev` reinicia o servidor quando o código muda. No Windows, `start.cmd` inicia o processo.

Ao iniciar o servidor, acesse `http://localhost:3001/` para abrir o cliente web de teste. Ele acompanha o preço e as ordens públicas, permite criar/conectar uma carteira e enviar compras e vendas simuladas. A chave informada fica em `sessionStorage` e é removida ao encerrar a sessão do navegador ou desconectar a carteira.

Use o cliente apenas em ambiente local ou confiável; não informe chaves em uma instalação pública. Em produção, não armazene chaves de API em aplicações web: use um backend próprio com controles de acesso adequados.

### Docker e persistência

Para iniciar com Docker Compose:

```powershell
docker compose up -d --build
```

O Compose monta `./data` do host em `/app/data` no container e grava o estado em `data/market-state.json`. Esse arquivo inclui contas, hashes das chaves, saldos, histórico de ordens, preço e volume; ele continua disponível ao reiniciar ou recriar o container e pode ser incluído em backups/sincronização do host. O campo `accounts` fica vazio até que uma conta seja criada por `POST /api/accounts`.

Confira as contas persistidas no host com:

```powershell
node -e "const s = require('./data/market-state.json'); console.log(s.accounts.length)"
```

A chave de API em texto puro não é salva no arquivo, então cada usuário precisa guardar a chave recebida ao criar a conta. Rode apenas uma instância do serviço usando esse arquivo; sincronizar ou compartilhar o mesmo arquivo entre instâncias ativas pode causar sobrescrita de estado.

Por padrão, a API escuta na porta `3001` e o estado fica em `data/market-state.json`, dentro deste projeto. Configure `MARKET_PORT` para trocar a porta ou `MARKET_STATE_FILE` para usar outro arquivo de estado.

Eventos simulados movimentam o preço em intervalos aleatórios de 60 a 120 segundos. Configure `MARKET_EVENT_MIN_INTERVAL_MS` e `MARKET_EVENT_MAX_INTERVAL_MS` para alterar os limites em milissegundos. Se o máximo for menor que o mínimo, o mínimo será usado como os dois limites.

Se estiver atrás de um reverse proxy confiável, configure `TRUST_PROXY` com o endereço ou faixa desse proxy, por exemplo `loopback` para um proxy local. Não use `true` indiscriminadamente: o endereço IP é usado nos limites de requisição.

Ao ser executado dentro da estrutura original do bot, se ainda não houver estado local, o servidor copia automaticamente o histórico legado de `../data/market-state.json`. Essa migração não apaga o arquivo antigo. Inicie o serviço uma vez antes de mover a pasta para levar junto a cópia migrada.

## Logs

O servidor escreve logs estruturados em JSON no console do processo, um evento por linha. Registra requisições HTTP com método, caminho, status e duração, além de eventos de mercado, ordens, ciclo de contas e operações de persistência. Erros são enviados ao `stderr`; os demais níveis vão para `stdout`. Query strings, corpos das requisições e cabeçalhos de autenticação não são registrados, portanto chaves de API não aparecem nos logs.

## API

`GET /api/market/status` é público. Retorna preço, sequência, histórico recente, volume e as ordens públicas recentes, sem expor dados de contas.

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

`POST /api/accounts` cria uma carteira virtual com US$ 1.000 e retorna uma chave de API aleatória. A chave aparece apenas nessa resposta; o servidor guarda somente seu hash. Cada usuário deve criar e proteger sua própria chave.

`GET /api/account` e `GET /api/account/history` exigem `Authorization: Bearer SUA_CHAVE_API`.
`POST /api/account/rotate-key` revoga a chave atual e devolve uma nova, exibida somente uma vez.

`POST /api/orders` também exige essa autenticação. Compra usa valor em dólares; venda usa unidades do ativo:

```json
{ "side": "BUY", "quoteAmount": 100 }
```

```json
{ "side": "SELL", "assetAmount": 0.5 }
```

Exemplo de uso no PowerShell por um cliente externo:

```powershell
$account = Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/accounts"
$apiKey = $account.data.apiKey
$headers = @{ Authorization = "Bearer $apiKey" }
Invoke-RestMethod -Uri "http://localhost:3001/api/account" -Headers $headers
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/orders" -Headers $headers -ContentType "application/json" -Body (@{ side = "BUY"; quoteAmount = 100 } | ConvertTo-Json)
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/orders" -Headers $headers -ContentType "application/json" -Body (@{ side = "SELL"; assetAmount = 0.5 } | ConvertTo-Json)
```

Cada participante deve guardar sua chave e usar sua própria carteira. Não compartilhe uma chave entre usuários.

Uma compra pressiona o preço global para cima; uma venda, para baixo. O efeito é limitado a 0,25% por ordem e o tamanho máximo é US$ 5.000 por ordem. Além das ordens de usuários e bots enviadas por essa API, eventos simulados de inflação, guerra, política, juros, tecnologia e emprego aplicam choques periódicos positivos ou negativos ao preço. O status público informa o último evento e a previsão do próximo. Esses cenários são aleatórios e não representam notícias ou dados do mundo real. O preço, os eventos, as contas, o volume e o histórico de ordens são persistidos neste servidor.

O cadastro está limitado a 5 chamadas por IP por hora; ordens, a 60 por IP por minuto e 20 por conta por minuto; rotação, a 3 por IP por hora. O servidor deve rodar como uma única autoridade de mercado; várias instâncias com arquivos locais separados não compartilham preço nem saldos.

Os limites usam armazenamento em memória e reiniciam quando o processo reinicia. Para alto volume ou múltiplas instâncias, migre contas, ordens, preço e limites para um banco compartilhado antes de escalar.

Clientes podem consultar essa rota sem conta ou chave. Se o servidor estiver em outra máquina, use a URL pública HTTPS e libere somente a porta necessária no firewall.
Qualquer cliente pode usar essas rotas com sua própria conta e chave Bearer. Não embuta a chave em código público de navegador, URLs ou repositórios; aplicações web devem intermediar ordens por um backend protegido. A integração para o bot automatizar ordens fica para outra etapa. Ao publicar na internet, use HTTPS.

Este serviço é paper trading; não se conecta a uma bolsa ou corretora real.

Este serviço é um simulador aleatório para paper trading; não se conecta a uma bolsa ou corretora real.
