# Market Simulation Server

Servidor Node.js independente de alta performance para **paper trading**, geração de preços simulados dinâmicos e testes de bots ou algoritmos de negociação via API REST.

O projeto é 100% autônomo, não se conecta a bolsas ou corretoras reais e persiste todos os dados localmente através de uma estrutura modular de arquivos JSON com escritas atômicas e controle de concorrência.

---

## 🚀 Principais Recursos

- **Simulação Realista de Mercado**: Formação contínua de preços com impacto proporcional ao volume das ordens de compra/venda, liquidez de referência e reversão à média (*mean reversion*).
- **Eventos Macroeconômicos Dinâmicos**: Choques periódicos de volatilidade cobrindo inflação, juros, política, guerra, tecnologia e emprego.
- **API REST Completa e Segura**: Autenticação via tokens Bearer, hashes SHA-256 (chaves nunca salvas em texto puro) e controle de taxa de requisições (*rate limiting*).
- **Cluster Distribuído (Master / Node)**: Replicação em tempo real com controle de concorrência otimista baseado em revisões (`syncRevision`), detecção de conflitos (`HTTP 409`) e reconciliação automática.
- **Persistência Atômica e Modular**: 8 arquivos JSON com serialização de gravações e proteção contra gravações parciais por renomeação temporária.
- **Interface Web Integrada**:
  - **Cliente do Trader** (`/`): Acompanhamento do mercado, carteira e envio de ordens.
  - **Painel Administrativo** (`/admin`): Gestão de usuários, permissões, regeneração de chaves e status do cluster.
- **Observabilidade**: Logs estruturados em formato JSON Lines (`data/logs/`) com sanitização automática de credenciais.

---

## ⚡ Início Rápido

### Pré-requisitos
- [Node.js](https://nodejs.org/) versão 20 ou superior.

### Instalação e Inicialização Local

```bash
# 1. Instalar as dependências
npm install

# 2. Iniciar o servidor em produção
npm start
```

Durante o desenvolvimento, execute `npm run dev` para reiniciar automaticamente após alterações de código. No Windows, você pode utilizar o atalho `start.cmd`.

Após iniciar, abra no navegador:
- **Painel do Trader**: [http://localhost:3001/](http://localhost:3001/)
- **Painel do Administrador**: [http://localhost:3001/admin](http://localhost:3001/admin)

---

## 🐳 Executando com Docker

### Modo Standalone (Servidor Único)
```bash
docker compose up -d --build
```
Os dados permanecem persistidos no host através do volume montado `./data:/app/data`.

### Modo Cluster (Master + 2 Nodes Replicados)
```bash
docker compose -f compose.cluster.yaml up -d --build
```
- **Master**: Porta `3001`
- **Node 1**: Porta `3002`
- **Node 2**: Porta `3003`

---

## 📚 Mapa da Documentação

A documentação detalhada do projeto está organizada no diretório [`docs/`](docs/):

| Documento | Descrição |
| --- | --- |
| 📖 [**Documentação da API REST**](docs/api-docs.md) | Catálogo completo de endpoints, parâmetros, respostas JSON, erros, rate limits e exemplos com `curl`. |
| 🛠️ [**Instalação e Configuração**](docs/instalacao-e-configuracao.md) | Pré-requisitos, variáveis de ambiente, Docker, configuração de proxy reverso e comandos. |
| 📈 [**Mecânica do Mercado**](docs/mecanica-do-mercado.md) | Modelagem matemática de preços, cálculo de impacto por ordem, reversão à média e catálogo de eventos macroeconômicos. |
| 🌐 [**Cluster e Sincronização**](docs/cluster-e-sincronizacao.md) | Topologia Master/Node, controle de concorrência por revisão (`syncRevision`), resolução de conflitos e orquestração. |
| 💾 [**Arquivos de Dados JSON**](docs/arquivos-de-dados.md) | Estrutura modular dos 8 arquivos de persistência (`data/`), ciclo de escrita atômica e segurança. |
| 📋 [**Logs, Auditoria e Backups**](docs/backups-e-logs.md) | Sistema de logs estruturados (JSON Lines), política de privacidade e exportação/restauração de snapshots. |

---

## 🔌 Resumo Rápido dos Endpoints da API

Todas as rotas de API residem sob o prefixo `/api`:

| Método | Endpoint | Autenticação | Descrição |
| --- | --- | --- | --- |
| `GET` | `/api/market/status` | Pública | Retorna preço atual, sequência, histórico e eventos recentes. |
| `GET` | `/api/market/events` | Pública | Lista histórico de eventos macroeconômicos simulados. |
| `POST` | `/api/accounts` | Pública | Cria carteira virtual com US$ 1.000 e gera a chave de API. |
| `GET` | `/api/account` | `Bearer <KEY>` | Consulta saldo e custódia de ativos da conta autenticada. |
| `GET` | `/api/account/history` | `Bearer <KEY>` | Histórico de ordens executadas da conta. |
| `POST` | `/api/account/rotate-key` | `Bearer <KEY>` | Revoga a chave atual e gera uma nova credencial (administradores podem especificar `accountId` no body). |
| `POST` | `/api/orders/buy` | `Bearer <KEY>` | Envia ordem de compra informando `{ "amount": quoteUSD }`. |
| `POST` | `/api/orders/sell` | `Bearer <KEY>` | Envia ordem de venda informando `{ "amount": assetUnits }`. |
| `GET` | `/api/admin/accounts` | Admin | Lista todas as contas de usuários e administradores. |
| `POST` | `/api/admin/accounts` | Admin | Cria nova conta especificando status de administrador. |
| `PATCH` | `/api/admin/accounts/:id` | Admin | Atualiza `username` ou status de admin de uma conta. |
| `POST` | `/api/admin/accounts/:id/rotate-key` | Admin | Regenera a chave de API da conta especificada (usuário ou administrador). |
| `DELETE` | `/api/admin/accounts/:id` | Admin | Remove uma conta e suas negociações associadas. |
| `GET` | `/api/backup` | Pública | Download de snapshot completo em arquivo JSON. |
| `POST` | `/api/backup/restore` | Admin | Restaura todas as coleções a partir de snapshot JSON. |
| `GET` | `/api/admin/cluster/status` | Admin | Exibe métricas de replicação, revisões e nós registrados. |
| `POST` | `/api/admin/cluster/pull` | Admin | Força o nó a sincronizar com o master. |
| `POST` | `/api/admin/cluster/push` | Admin | Força o nó a enviar seu estado ao master. |

> Consulte o arquivo [docs/api-docs.md](docs/api-docs.md) para payloads completos e códigos de retorno.

---

## 🧪 Testes e Migração

```bash
# Executa a suíte de testes de consistência financeira e concorrência
npm test

# Executa/valida a migração de banco de dados para o padrão modular
npm run migrate
```

---

## 🛡️ Aviso Legal (Disclaimer)

Este projeto foi desenvolvido com propósitos estritamente educacionais e de pesquisa em estratégias algorítmicas de negociação (**Paper Trading**). As informações, eventos e cotações geradas são puramente matemáticas e aleatórias, sem qualquer representação ou vínculo com ativos financeiros ou mercados do mundo real.
