# Logs, Auditoria e Backups

Este documento descreve as práticas de observabilidade, rotação de logs estruturados, políticas de privacidade, geração de snapshots de backup e recuperação de dados do **Market Simulation Server**.

---

## 1. Sistema de Logs Estruturados

O servidor utiliza um mecanismo de log nativo e resiliente implementado em `src/utils/logger.js`, gravando eventos em arquivos diários rotacionados automaticamente.

### 1.1 Localização e Formato
- **Diretório Padrão**: `data/logs/` (configurável através da variável `MARKET_LOG_DIRECTORY`).
- **Nomenclatura**: `market-AAAA-MM-DD.log` (um arquivo novo para cada dia).
- **Formato**: JSON estruturado por linha (*JSON Lines / NDJSON*), facilitando a ingestão por plataformas como Datadog, Grafana Loki, ELK Stack ou AWS CloudWatch.

#### Exemplo de Entrada de Log:
```json
{"timestamp":"2026-10-07T21:00:15.123Z","level":"info","event":"http.request","method":"POST","path":"/api/orders/buy","statusCode":201,"durationMs":14.28}
```

### 1.2 Eventos Monitorados
- **Requisições HTTP**: Método, path, código de status retornado e tempo total de resposta (`durationMs`).
- **Eventos de Mercado**: Notícias e choques econômicos disparados, categoria e impacto percentual.
- **Ordens de Negociação**: Identificador de ordem, conta envolvida, volume e resultado.
- **Sincronização de Cluster**: PUSH, PULL, revisões trocadas e ocorrências de conflitos (`409 Conflict`).
- **Persistência**: Gravações atômicas e migrações executadas no banco de dados JSON.

### 1.3 Privacidade e Sanitização de Dados
Para garantir estrita conformidade com boas práticas de segurança:
- **Corpos de Requisição (`req.body`)**: Nunca são persistidos em logs.
- **Parâmetros de Query**: Parâmetros sensíveis não são logados.
- **Cabeçalhos de Autenticação**: O conteúdo de `Authorization` e `X-Market-Sync-Token` é expressamente omitido.
- **Chaves de API**: Apenas identificadores públicos (`accountId` e `username`) aparecem em registros de auditoria. As chaves em texto puro e seus respectivos hashes nunca são impressos em log.

---

## 2. Snapshots de Backup

O sistema permite extrair uma fotografia instantânea e completa de todas as 8 coleções de dados persistidas no servidor.

### 2.1 Exportação de Backup
- Rota: `GET /api/backup`
- Retorna um arquivo JSON consolidado para download direto (`Content-Disposition: attachment; filename="market-backup.json"`).
- O arquivo inclui:
  - Metadados de versão e timestamp de exportação.
  - Coleção de contas (`accounts`).
  - Ativos e preços (`assets`).
  - Posições de custódia (`portfolios`).
  - Histórico de ordens (`orders`).
  - Negociações executadas (`trades`).
  - Série temporal de cotações (`marketHistory`).
  - Eventos ocorridos (`marketEvents`).
  - Estado operacional atual do mercado (`marketState`).

### 2.2 Restauração de Dados
- Rota: `POST /api/backup/restore`
- **Requer**: Autenticação com credencial de administrador (`Bearer <ADMIN_API_KEY>`).
- **Comportamento**:
  1. O servidor valida a integridade do JSON fornecido.
  2. Antes de qualquer alteração, cria automaticamente uma cópia de segurança em `data/backups/`.
  3. Todas as 8 coleções ativas são substituídas pelo conteúdo do snapshot.
  4. Nenhuma informação anterior é mesclada; o mercado retorna exatamente ao estado em que o backup foi gerado.

---

## 3. Diretório de Backups Internos (`data/backups/`)

Além das restaurações manuais via API, o servidor cria snapshots automáticos de segurança nas seguintes ocasiões:
- Antes de aplicar uma migração de banco de dados (`npm run migrate`).
- Antes de converter a base monolítica legada para o modelo modular de 8 arquivos JSON.
- Antes de processar qualquer substituição via `POST /api/backup/restore`.

> [!WARNING]
> Os arquivos em `data/backups/` e `data/accounts.json` contêm dados de contas e hashes de credenciais. Nunca exponha a pasta `data/` publicamente ou em repositórios abertos de versionamento (Git).

