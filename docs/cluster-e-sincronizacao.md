# Arquitetura de Cluster e Sincronização Distribuída

Este documento detalha o funcionamento da replicação de dados entre instâncias do **Market Simulation Server**, cobrindo os papéis do sistema (*Master*, *Node*, *Standalone*), controle de concorrência por revisão otimista, resolução de conflitos e orquestração com Docker.

---

## 1. Visão Geral da Topologia

O servidor suporta sincronização distribuída com modelo de **autoridade única (*single-authority*)**:

```
                  +---------------------------+
                  |       MASTER SERVER       |
                  |  (Fonte Única da Verdade) |
                  |    syncRevision: 142      |
                  +-------------+-------------+
                                |
             +------------------+------------------+
             | (HTTP /api/sync)                    | (HTTP /api/sync)
             v                                     v
+-------------------------+           +-------------------------+
|      NODE SERVER 1      |           |      NODE SERVER 2      |
|  (Atendimento Local)    |           |   (Atendimento Local)   |
|   syncRevision: 142     |           |    syncRevision: 142    |
+-------------------------+           +-------------------------+
```

### Papéis de Execução (`MARKET_SYNC_ROLE`)

1. **`standalone`** (Padrão):
   A instância opera isolada, persistindo dados localmente em sua própria pasta `data/`. Não requer nem atende outros servidores.

2. **`master`**:
   Atua como a fonte definitiva da verdade. Centraliza o incremento das revisões (`syncRevision`), valida transações enviadas pelos nós e disponibiliza snapshots completos.

3. **`node`**:
   Instância satélite que atende clientes e bots de trading. Sincroniza periodicamente com o master e propaga alterações locais conforme o modo configurado.

---

## 2. Modos de Sincronização do Node (`MARKET_NODE_SYNC_MODE`)

- **`bidirectional`** (Padrão):
  O nó recebe atualizações do master e também envia alterações locais (criação de contas, ordens executadas) de volta ao master.
- **`receive-only`**:
  O nó opera em modo espelho (somente leitura). Periodicamente baixa snapshots do master, mas não envia alterações locais. Se alterações locais forem feitas no nó, elas poderão ser sobrescritas quando uma nova revisão do master for aplicada.

---

## 3. Controle de Concorrência e Resolução de Conflitos

Para manter a consistência financeira sem bloqueios distribuídos complexos (como Two-Phase Commit), o servidor emprega **Controle de Concorrência Otimista baseado em Revisão (*Optimistic Concurrency Control*)**:

### Fluxo de Uma Operação Bem-Sucedida:
1. O Node A e o Master estão em sincronia na revisão `syncRevision = 10`.
2. Um trader submete uma ordem de compra no Node A.
3. O Node A prepara o snapshot com a ordem e envia via `PUT /api/sync/snapshot` informando `baseRevision: 10`.
4. O Master verifica que sua revisão atual ainda é `10`. Ele aceita a alteração, grava o snapshot no disco atômico e atualiza a revisão para `11`.
5. O Master responde com sucesso `HTTP 200` contendo `{ "revision": 11 }`.

### Fluxo de Conflito de Concorrência (`HTTP 409 Conflict`):
1. O Node A e o Node B estão na revisão `10`.
2. Usuários enviam ordens simultaneamente no Node A e no Node B.
3. O Node A atinge o Master primeiro com `baseRevision: 10`. O Master aprova e incrementa sua revisão para `11`.
4. Milissegundos depois, o Node B envia seu snapshot também com `baseRevision: 10`.
5. O Master detecta divergência (`10 !== 11`). Ele **rejeita** a alteração do Node B com status `HTTP 409 Conflict` e informa a revisão atual `11`.
6. O Node B reconhece o conflito, descarta a operação rejeitada, realiza rollback e executa um **PULL** do snapshot mais recente da revisão `11` do Master.

---

## 4. Heartbeat e Registro de Nós (*Cluster Registry*)

Durante todas as requisições enviadas ao Master (`/api/sync/status` ou `/api/sync/snapshot`), os nós enviam cabeçalhos HTTP com metadados diagnósticos:

| Cabeçalho HTTP | Descrição |
| --- | --- |
| `X-Market-Sync-Token` | Token secreto de autenticação configurado em `MARKET_SYNC_TOKEN`. |
| `X-Market-Node-Id` | Identificador único do nó (`MARKET_NODE_ID`). |
| `X-Market-Node-Revision` | Revisão local atual mantida no nó. |
| `X-Market-Node-Version` | Versão da aplicação instalada no nó. |
| `X-Market-Node-Port` | Porta de escuta configurada no processo do nó. |
| `X-Market-Node-Sync-Interval-Ms` | Intervalo configurado de sincronização do nó. |
| `X-Market-Node-Url` | URL pública acessível para abrir a interface do nó. |

O Master atualiza esses dados em memória através do `clusterRegistry.js` e expõe a lista consolidada em `GET /api/admin/cluster/status` e na interface web `/admin.html`.

---

## 5. Orquestração com Docker Compose

O repositório já inclui configurações prontas para testar o cluster completo localmente:

### 5.1 Subir Cluster Completo (Master + 2 Nodes)
Utilize o arquivo `compose.cluster.yaml`:

```bash
docker compose -f compose.cluster.yaml up -d --build
```

Neste cenário:
- **Master**: Disponibilizado na porta `3001`.
- **Node 1**: Disponibilizado na porta `3002`.
- **Node 2**: Disponibilizado na porta `3003`.
- Rede interna privada bridge compartilhada para comunicação rápida entre os containers.

### 5.2 Subir Apenas Nós Conectados a um Master Externo
Utilize o arquivo `compose.nodes.yaml` e defina as variáveis no `.env` apontando para a URL do seu Master (por exemplo em nuvem no Render, AWS ou VPS):

```bash
docker compose -f compose.nodes.yaml up -d --build
```

---

## 6. Endpoints do Cluster

Administradores autenticados podem consultar o status do cluster e forçar reconciliações sob demanda:

- `GET /api/admin/cluster/status`: Retorna o papel da instância, revisão atual e lista de nós ativos.
- `POST /api/admin/cluster/pull`: Força o nó a baixar o snapshot mais recente do master.
- `POST /api/admin/cluster/push`: Força o envio imediato do estado local do nó para o master.

