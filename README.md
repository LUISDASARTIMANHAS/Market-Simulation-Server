# Market Simulation Server

Servidor Node.js independente que gera preços simulados e os disponibiliza por HTTP. Não importa código do projeto do bot e pode ser movido para outro diretório ou repositório.

## Instalação e execução

Requer Node.js 20 ou superior.

```powershell
npm install
npm start
```

Durante o desenvolvimento, `npm run dev` reinicia o servidor quando o código muda. No Windows, `start.cmd` inicia o processo.

Por padrão, a API escuta na porta `3001` e o estado fica em `data/market-state.json`, dentro deste projeto. Configure `MARKET_PORT` para trocar a porta ou `MARKET_STATE_FILE` para usar outro arquivo de estado.

Se estiver atrás de um reverse proxy confiável, configure `TRUST_PROXY` com o endereço ou faixa desse proxy, por exemplo `loopback` para um proxy local. Não use `true` indiscriminadamente: o endereço IP é usado nos limites de requisição.

Ao ser executado dentro da estrutura original do bot, se ainda não houver estado local, o servidor copia automaticamente o histórico legado de `../data/market-state.json`. Essa migração não apaga o arquivo antigo. Inicie o serviço uma vez antes de mover a pasta para levar junto a cópia migrada.

## API

`GET /api/market/status` é público. Retorna preço, sequência, histórico recente, volume e as ordens públicas recentes, sem expor dados de contas.

```json
{
  "success": true,
  "data": {
    "currentPrice": 100.25,
    "sequence": 42,
    "updatedAt": "2026-10-07T21:00:00.000Z",
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

Uma compra pressiona o preço global para cima; uma venda, para baixo. O efeito é limitado a 0,25% por ordem e o tamanho máximo é US$ 5.000 por ordem. O ticker aleatório continua, com variação menor, para representar o fluxo de mercado sem impor somente uma direção. O preço, as contas, o volume e o histórico de ordens são persistidos neste servidor.

O cadastro está limitado a 5 chamadas por IP por hora; ordens, a 60 por IP por minuto e 20 por conta por minuto; rotação, a 3 por IP por hora. O servidor deve rodar como uma única autoridade de mercado; várias instâncias com arquivos locais separados não compartilham preço nem saldos.

Os limites usam armazenamento em memória e reiniciam quando o processo reinicia. Para alto volume ou múltiplas instâncias, migre contas, ordens, preço e limites para um banco compartilhado antes de escalar.

Clientes podem consultar essa rota sem conta ou chave. Se o servidor estiver em outra máquina, use a URL pública HTTPS e libere somente a porta necessária no firewall.
Qualquer cliente pode usar essas rotas com sua própria conta e chave Bearer. Não embuta a chave em código público de navegador, URLs ou repositórios; aplicações web devem intermediar ordens por um backend protegido. A integração para o bot automatizar ordens fica para outra etapa. Ao publicar na internet, use HTTPS.

Este serviço é paper trading; não se conecta a uma bolsa ou corretora real.

Este serviço é um simulador aleatório para paper trading; não se conecta a uma bolsa ou corretora real.
