# Documentação da API REST

Esta documentação descreve todos os endpoints disponibilizados pelo **Market Simulation Server**, detalhando autenticação, cabeçalhos, parâmetros de requisição, formatos de payload, respostas de sucesso e erro, e regras de limitação de taxa (*rate limiting*).

---

## 1. Visão Geral e Convenções

- **Protocolo**: HTTP / HTTPS
- **Formato de Dados**: JSON (`application/json`)
- **Codificação**: UTF-8
- **Porta Padrão**: `3001` (configurável via variável de ambiente `MARKET_PORT`)
- **Prefixo Base**: Todas as rotas de API residem sob `/api`

### Formato Padrão de Resposta

Todas as respostas de sucesso retornadas pela API utilizam a estrutura com envelope contendo o objeto de metadados do servidor (`meta.server`):

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "server": {
      "name": "market-server-primary",
      "version": "1.5.3",
      "role": "standalone"
    }
  }
}
```

O campo `meta.server` identifica a instância responsável pelo atendimento:
- `name`: Nome da instância (definido por `MARKET_SERVER_NAME`, `MARKET_NODE_ID` ou hostname da máquina).
- `version`: Versão do serviço extraída do `package.json`.
- `role`: Papel no cluster (`standalone`, `master` ou `node`).

### Formato Padrão de Erro

Em caso de falha, o status code HTTP correspondente é retornado junto ao payload padronizado:

```json
{
  "success": false,
  "message": "market-server-primary - versão 1.5.3:standalone error: Mensagem explicativa do erro",
  "meta": {
    "server": {
      "name": "market-server-primary",
      "version": "1.5.3",
      "role": "standalone"
    }
  }
}
```

### Códigos de Status HTTP

| Código | Descrição |
| --- | --- |
| `200 OK` | Requisição processada com sucesso. |
| `201 Created` | Recurso criado com sucesso (ex: criação de conta ou envio de ordem). |
| `400 Bad Request` | Parâmetros inválidos, ausentes ou malformados. |
| `401 Unauthorized` | Chave de API ausente, malformada ou inválida. |
| `403 Forbidden` | Permissão insuficiente (ex: rota restrita a administradores). |
| `404 Not Found` | Rota ou recurso não encontrado. |
| `409 Conflict` | Conflito de concorrência ou revisão desatualizada de node. |
| `429 Too Many Requests` | Limite de taxa de requisições excedido. |
| `500 Internal Server Error` | Erro inesperado interno do servidor. |
| `502 Bad Gateway` | Falha de comunicação com o servidor master. |

---

## 2. Autenticação e Segurança

### Chaves de API (*API Keys*)
- Contas regulares e administrativas autenticam-se enviando o cabeçalho HTTP:
  ```http
  Authorization: Bearer <API_KEY>
  ```
- **Importante**: O servidor **nunca** armazena a chave de API em texto puro; somente o seu hash SHA-256 (`keyHash`) é persistido no banco de dados. A chave é exibida uma única vez no momento da criação da conta ou rotação de credencial.
- O token administrativo do sistema pode ser definido estaticamente através da variável de ambiente `MARKET_ADMIN_TOKEN` ou gerado aleatoriamente na inicialização do servidor.

### Sincronização entre Servidores
- Comunicações internas do cluster entre nós e o master utilizam o cabeçalho:
  ```http
  X-Market-Sync-Token: <MARKET_SYNC_TOKEN>
  ```

---

## 3. Limites de Taxa (*Rate Limiting*)

Os limites são aplicados em memória e protegem o servidor contra abusos:

| Finalidade | Janela de Tempo | Limite | Escopo |
| --- | --- | --- | --- |
| Criação de contas (`POST /api/accounts`) | 60 segundos | 7 requisições | Por IP |
| Submissão global de ordens (`POST /api/orders/*`) | 60 segundos | 60 requisições | Por IP |
| Submissão por conta (`POST /api/orders/*`) | 60 segundos | 20 requisições | Por Conta (`accountId`) |
| Rotação de chaves (`POST /api/account/rotate-key`) | 3600 segundos (1h) | 3 requisições | Por IP |

---

## 4. Endpoints Públicos de Mercado

### 4.1 Obter Status do Mercado
Retorna o estado operacional atual do mercado, incluindo cotação do ativo, sequência, eventos recentes, ordens públicas e série histórica. Não expõe dados privados de contas.

- **Método**: `GET`
- **Rota**: `/api/market/status`
- **Autenticação**: Nenhuma (Público)

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "data": {
    "currentPrice": 100.25,
    "sequence": 42,
    "updatedAt": "2026-10-07T21:00:00.000Z",
    "latestEvent": {
      "eventId": "e9b2c3d4-4567-89ab-cdef-0123456789ab",
      "category": "Inflação",
      "title": "Inflação desacelera",
      "description": "Alívio inflacionário melhora o apetite por risco.",
      "impactPercent": 0.52,
      "occurredAt": "2026-10-07T20:59:00.000Z"
    },
    "events": [
      {
        "eventId": "e9b2c3d4-4567-89ab-cdef-0123456789ab",
        "assetId": "SIM",
        "category": "Inflação",
        "title": "Inflação desacelera",
        "description": "Alívio inflacionário melhora o apetite por risco.",
        "impactPercent": 0.52,
        "occurredAt": "2026-10-07T20:59:00.000Z"
      }
    ],
    "nextEventAt": "2026-10-07T21:01:30.000Z",
    "volume": {
      "total": 12500.0,
      "buys": 8000.0,
      "sells": 4500.0
    },
    "recentTrades": [
      {
        "tradeId": "t1-trade-uuid",
        "orderId": "o1-order-uuid",
        "accountId": "acc-alice-uuid",
        "username": "alice_trader",
        "assetId": "SIM",
        "side": "BUY",
        "amount": 100.0,
        "price": 100.25,
        "total": 100.0,
        "impact": 0.4,
        "executedAt": "2026-10-07T20:59:30.000Z"
      }
    ],
    "history": [
      {
        "sequence": 42,
        "price": 100.25,
        "updatedAt": "2026-10-07T21:00:00.000Z"
      }
    ]
  },
  "meta": {
    "server": {
      "name": "market-standalone",
      "version": "1.5.3",
      "role": "standalone"
    }
  }
}
```

---

### 4.2 Listar Eventos Macroeconômicos
Retorna a lista completa de todos os eventos simulados ocorridos no mercado, ordenados do mais recente para o mais antigo.

- **Método**: `GET`
- **Rota**: `/api/market/events`
- **Autenticação**: Nenhuma (Público)
- **Parâmetros de Query**:
  - `limit` *(opcional, número)*: Número máximo de eventos a retornar. Se omitido, retorna todos os eventos gravados.

#### Exemplo de Requisição
```bash
curl http://localhost:3001/api/market/events?limit=10
```

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "eventId": "f78d1234-5678-90ab-cdef-1234567890ab",
      "assetId": "SIM",
      "category": "Juros",
      "title": "Corte de juros anunciado",
      "description": "Banco Central reduz taxa básica, impulsionando ativos.",
      "impactPercent": 1.25,
      "occurredAt": "2026-10-07T21:05:00.000Z"
    }
  ]
}
```

---

## 5. Endpoints de Contas e Usuários

### 5.1 Criar Conta de Usuário
Cria uma nova carteira virtual para paper trading com saldo inicial padrão de **US$ 1.000,00** e gera uma chave de API aleatória única.

- **Método**: `POST`
- **Rota**: `/api/accounts`
- **Autenticação**: Nenhuma
- **Rate Limit**: 7 criações por IP por minuto

#### Corpo da Requisição (`application/json`)
```json
{
  "username": "trader_bob"
}
```
*Regras para `username`:*
- Obrigatório.
- De 3 a 24 caracteres.
- Não pode conter espaços.
- Caracteres permitidos: letras (`a-z`, `A-Z`), números (`0-9`), ponto (`.`), sublinhado (`_`) e hífen (`-`).

#### Resposta de Sucesso (`201 Created`)
```json
{
  "success": true,
  "data": {
    "account": {
      "accountId": "8c353c89-fb4d-444a-99de-8386187b5a8e",
      "username": "trader_bob",
      "balance": 1000.0,
      "createdAt": "2026-10-07T21:10:00.000Z",
      "portfolio": []
    },
    "apiKey": "mkt_sec_9f83b27a8e...",
    "warning": "Guarde a chave agora. Ela não será exibida novamente."
  }
}
```

---

### 5.2 Obter Dados da Conta Autenticada
Retorna o perfil da conta associada à chave de API informada, incluindo saldo em dinheiro e posições em custódia.

- **Método**: `GET`
- **Rota**: `/api/account`
- **Autenticação**: `Bearer <API_KEY>`

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "data": {
    "account": {
      "accountId": "8c353c89-fb4d-444a-99de-8386187b5a8e",
      "username": "trader_bob",
      "balance": 850.50,
      "portfolio": [
        {
          "assetId": "SIM",
          "amount": 1.488,
          "averagePrice": 100.45,
          "updatedAt": "2026-10-07T21:15:00.000Z"
        }
      ],
      "createdAt": "2026-10-07T21:10:00.000Z"
    }
  }
}
```

---

### 5.3 Obter Histórico de Ordens da Conta
Retorna o histórico das ordens executadas pela conta autenticada (limitado às últimas 100 ordens).

- **Método**: `GET`
- **Rota**: `/api/account/history`
- **Autenticação**: `Bearer <API_KEY>`

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "orderId": "b182d334-1111-2222-3333-444455556666",
      "accountId": "8c353c89-fb4d-444a-99de-8386187b5a8e",
      "assetId": "SIM",
      "side": "BUY",
      "amount": 100.0,
      "price": 100.25,
      "total": 100.0,
      "impact": 0.4,
      "status": "FILLED",
      "createdAt": "2026-10-07T21:12:00.000Z"
    }
  ]
}
```

---

### 5.4 Rotacionar Chave de API
Revoga imediatamente a credencial atual da conta e gera uma nova chave de acesso.

- **Método**: `POST`
- **Rota**: `/api/account/rotate-key`
- **Autenticação**: `Bearer <API_KEY>` (a chave que se deseja substituir)
- **Rate Limit**: 3 rotações por IP por hora

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "data": {
    "account": {
      "accountId": "8c353c89-fb4d-444a-99de-8386187b5a8e",
      "username": "trader_bob",
      "balance": 850.50
    },
    "apiKey": "mkt_sec_novo_token_gerado...",
    "warning": "A chave anterior foi revogada. Guarde a nova chave; ela não será exibida novamente."
  }
}
```

---

## 6. Endpoints de Negociação (*Trading*)

### 6.1 Enviar Ordem de Compra (*BUY*)
Executa uma ordem a mercado de compra de ativos utilizando saldo em dólares (moeda de cotação).
- O preço global do ativo sobre pressão altista proporcional ao volume executado.
- Limite máximo nocional de **US$ 5.000,00** por ordem.
- Impacto máximo limitado a **2%** por ordem sobre uma liquidez de referência de **US$ 250,00**.

- **Método**: `POST`
- **Rota**: `/api/orders/buy`
- **Autenticação**: `Bearer <API_KEY>`
- **Rate Limit**: 60 ordens por minuto por IP; 20 ordens por minuto por conta.

#### Corpo da Requisição (`application/json`)
```json
{
  "amount": 100.0
}
```
*`amount`: valor em dólares (USD) a ser investido na compra.*

#### Resposta de Sucesso (`201 Created`)
```json
{
  "success": true,
  "data": {
    "order": {
      "orderId": "349b1a0d-...",
      "accountId": "8c353c89-...",
      "assetId": "SIM",
      "side": "BUY",
      "amount": 100.0,
      "price": 100.35,
      "total": 100.0,
      "impact": 0.4,
      "status": "FILLED",
      "createdAt": "2026-10-07T21:20:00.000Z"
    },
    "account": {
      "accountId": "8c353c89-...",
      "balance": 900.0,
      "portfolio": [
        {
          "assetId": "SIM",
          "amount": 0.9965,
          "averagePrice": 100.35
        }
      ]
    },
    "market": {
      "currentPrice": 100.75,
      "sequence": 43
    }
  }
}
```

---

### 6.2 Enviar Ordem de Venda (*SELL*)
Executa uma ordem a mercado para venda de frações ou unidades de ativo previamente custodiadas na carteira.
- O preço global do ativo sofre pressão baixista proporcional ao volume vendido.
- O valor financeiro resultante da venda (`amount * preço_executado`) não pode ultrapassar **US$ 5.000,00** por ordem.
- A conta deve possuir quantidade suficiente do ativo em custódia.

- **Método**: `POST`
- **Rota**: `/api/orders/sell`
- **Autenticação**: `Bearer <API_KEY>`
- **Rate Limit**: 60 ordens por minuto por IP; 20 ordens por minuto por conta.

#### Corpo da Requisição (`application/json`)
```json
{
  "amount": 0.5
}
```
*`amount`: quantidade de unidades/frações do ativo a serem vendidas.*

#### Resposta de Sucesso (`201 Created`)
```json
{
  "success": true,
  "data": {
    "order": {
      "orderId": "782ca41e-...",
      "accountId": "8c353c89-...",
      "assetId": "SIM",
      "side": "SELL",
      "amount": 0.5,
      "price": 100.50,
      "total": 50.25,
      "impact": -0.2,
      "status": "FILLED",
      "createdAt": "2026-10-07T21:22:00.000Z"
    },
    "account": {
      "accountId": "8c353c89-...",
      "balance": 950.25,
      "portfolio": [
        {
          "assetId": "SIM",
          "amount": 0.4965,
          "averagePrice": 100.35
        }
      ]
    },
    "market": {
      "currentPrice": 100.30,
      "sequence": 44
    }
  }
}
```

---

## 7. Endpoints Administrativos

> [!IMPORTANT]
> Todas as rotas administrativas requerem autenticação com credencial de conta que possua a flag `isAdmin: true` ou o token administrativo do sistema (`MARKET_ADMIN_TOKEN`).

### 7.1 Listar Contas
Lista todas as contas registradas no sistema, sem expor chaves ou hashes de chaves.

- **Método**: `GET`
- **Rota**: `/api/admin/accounts`
- **Autenticação**: `Bearer <ADMIN_API_KEY>`

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "accountId": "system-admin-uuid",
        "username": "admin",
        "balance": 0.0,
        "isAdmin": true,
        "createdAt": "2026-10-07T00:00:00.000Z"
      },
      {
        "accountId": "user-uuid",
        "username": "alice",
        "balance": 1050.0,
        "isAdmin": false,
        "createdAt": "2026-10-07T12:00:00.000Z"
      }
    ]
  }
}
```

---

### 7.2 Criar Conta Administrativa ou Regular
Permite ao administrador criar uma conta especificando diretamente o papel de privilégio.

- **Método**: `POST`
- **Rota**: `/api/admin/accounts`
- **Autenticação**: `Bearer <ADMIN_API_KEY>`

#### Corpo da Requisição (`application/json`)
```json
{
  "username": "novo_supervisor",
  "isAdmin": true
}
```

#### Resposta de Sucesso (`201 Created`)
```json
{
  "success": true,
  "data": {
    "account": {
      "accountId": "uuid-da-nova-conta",
      "username": "novo_supervisor",
      "balance": 1000.0,
      "isAdmin": true
    },
    "apiKey": "mkt_sec_...",
    "warning": "Guarde a chave agora. Ela não será exibida novamente."
  }
}
```

---

### 7.3 Atualizar Conta
Permite alterar o nome de usuário (`username`) e/ou o status de administrador (`isAdmin`) de uma conta existente.

- **Método**: `PATCH`
- **Rota**: `/api/admin/accounts/:accountId`
- **Autenticação**: `Bearer <ADMIN_API_KEY>`

#### Corpo da Requisição (`application/json`)
```json
{
  "username": "alice_renomeada",
  "isAdmin": true
}
```

*Salvaguardas*:
- Um administrador não pode revogar seu próprio privilégio de admin.
- O sistema não permite remover o status de admin se for o último administrador existente.

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "data": {
    "account": {
      "accountId": "user-uuid",
      "username": "alice_renomeada",
      "isAdmin": true
    }
  }
}
```

---

### 7.4 Excluir Conta
Exclui a conta especificada e suas respectivas negociações e ordens.

- **Método**: `DELETE`
- **Rota**: `/api/admin/accounts/:accountId`
- **Autenticação**: `Bearer <ADMIN_API_KEY>`

*Salvaguardas*:
- Um administrador não pode excluir a si próprio.
- Não é permitido excluir o último administrador do sistema.

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "data": {
    "accountId": "user-uuid"
  }
}
```

---

## 8. Backup e Restauração

### 8.1 Exportar Snapshot de Backup
Gera e faz o download de um arquivo JSON contendo o snapshot consolidado de todas as 8 coleções de dados persistidas.

- **Método**: `GET`
- **Rota**: `/api/backup`
- **Autenticação**: Nenhuma (acesso direto a snapshots de leitura)
- **Cabeçalho de Retorno**: `Content-Disposition: attachment; filename="market-backup.json"`

#### Estrutura do Snapshot Exportado
```json
{
  "version": 1,
  "exportedAt": "2026-10-07T21:30:00.000Z",
  "accounts": [...],
  "assets": [...],
  "portfolios": [...],
  "orders": [...],
  "trades": [...],
  "marketHistory": [...],
  "marketEvents": [...],
  "marketState": { ... }
}
```

---

### 8.2 Restaurar a Partir de Backup
Restaura todo o estado da base de dados a partir de um objeto JSON válido de snapshot.
- Cria um backup prévio de segurança em `data/backups/` antes de aplicar a restauração.
- Substitui completamente as coleções existentes (não mescla).

- **Método**: `POST`
- **Rota**: `/api/backup/restore`
- **Autenticação**: `Bearer <ADMIN_API_KEY>`

#### Corpo da Requisição (`application/json`)
O corpo deve ser o objeto de snapshot JSON obtido via `GET /api/backup`.

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "message": "Banco de dados restaurado com sucesso!",
  "data": {
    "accountsRestored": 15,
    "tradesRestored": 120,
    "currentPrice": 100.25
  }
}
```

---

## 9. Cluster e Sincronização

### 9.1 Status do Cluster (Admin)
Retorna as métricas de sincronização da instância atual (papel, revisão local, revisão remota e lista de nós para servidores master).

- **Método**: `GET`
- **Rota**: `/api/admin/cluster/status`
- **Autenticação**: `Bearer <ADMIN_API_KEY>`

#### Resposta de Sucesso (`200 OK`)
```json
{
  "success": true,
  "data": {
    "role": "master",
    "localRevision": 128,
    "intervalMs": 5000,
    "nodes": [
      {
        "id": "node-1",
        "lastSeen": "2026-10-07T21:30:00.000Z",
        "revision": 128,
        "mode": "bidirectional",
        "url": "http://192.168.1.50:3002"
      }
    ]
  }
}
```

---

### 9.2 Sincronização Manual (Node: PULL)
Força o node a baixar imediatamente o estado consolidado mais recente do master.

- **Método**: `POST`
- **Rota**: `/api/admin/cluster/pull`
- **Autenticação**: `Bearer <ADMIN_API_KEY>`

---

### 9.3 Sincronização Manual (Node: PUSH)
Força o envio do snapshot do node para o servidor master.

- **Método**: `POST`
- **Rota**: `/api/admin/cluster/push`
- **Autenticação**: `Bearer <ADMIN_API_KEY>`

---

### 9.4 Rotas Internas de Comunicação entre Nós (`/api/sync`)
Utilizadas internamente pelo protocolo de replicação entre as instâncias Node e Master:

| Rota | Método | Descrição |
| --- | --- | --- |
| `/api/sync/status` | `GET` | Informa a revisão corrente (`syncRevision`) do master. |
| `/api/sync/snapshot` | `GET` | Retorna o snapshot completo do master para download pelo node. |
| `/api/sync/snapshot` | `PUT` | Envia o snapshot do node para o master. Exige `baseRevision`. Retorna `409 Conflict` se o node estiver atrasado. |

Todas as rotas `/api/sync/*` exigem o cabeçalho `X-Market-Sync-Token` configurado no ambiente.

