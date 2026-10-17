# Guia de Instalação e Configuração

Este documento apresenta os requisitos, as instruções de instalação e execução, a referência completa de variáveis de ambiente e a configuração de rede e proxy do **Market Simulation Server**.

---

## 1. Requisitos do Sistema

- **Node.js**: versão 20.0.0 ou superior (suporte nativo a ES Modules).
- **Gerenciador de Pacotes**: npm 10+ (incluído com o Node.js).
- **Docker e Docker Compose** (opcional, para execução conteinerizada ou em cluster).
- **Sistema Operacional**: Linux, macOS ou Windows (com PowerShell ou CMD).

---

## 2. Instalação e Execução Local

### 2.1 Clonar e Instalar Dependências

No terminal, navegue até a pasta do projeto e instale as dependências:

```bash
git clone https://github.com/seu-usuario/market-simulation-server.git
cd market-simulation-server
npm install
```

### 2.2 Modos de Execução

- **Modo Produção / Padrão**:
  Inicia o servidor com Node.js puro na porta configurada (padrão `3001`):
  ```bash
  npm start
  ```

- **Modo Desenvolvimento com Auto-Reload**:
  Utiliza o nodemon para reiniciar o processo automaticamente sempre que arquivos em `src/` forem alterados:
  ```bash
  npm run dev
  ```

- **Atalho no Windows**:
  Execute o arquivo em lote:
  ```cmd
  start.cmd
  ```

### 2.3 Acesso aos Painéis Web

Após a inicialização do servidor, acesse no navegador:

- **Dashboard do Mercado**: `http://localhost:3001/` (ou `/dashboard.html`)  
  Acompanhamento de cotações em tempo real, gráfico de preços, eventos econômicos, volume e histórico público de negociações.

- **Login e Cadastro**: `http://localhost:3001/login.html`  
  Página dedicada para criar uma carteira virtual ou conectar-se via chave de API (salva de forma persistente no `localStorage`).

- **Carteira & Operações**: `http://localhost:3001/wallet.html`  
  Visualização detalhada do patrimônio líquido, painel dedicado para compra e venda de ativos (com prévia em tempo real e atalhos de saldo) e histórico completo de movimentações com filtros por tipo.

- **Painel Administrativo**: `http://localhost:3001/admin.html`  
  Permite a administradores autenticados visualizar todas as contas cadastradas, criar contas com privilégios específicos, alterar nomes de usuário, promover/rebaixar permissões e excluir contas.

---

## 3. Execução com Docker e Docker Compose

O projeto já possui configuração pronta para execução conteinerizada.

### 3.1 Construir a Imagem Localmente

```bash
docker build -t market-simulation-server:latest .
```
*(No Windows, você também pode executar `docker-build.cmd`)*

### 3.2 Executar com Docker Compose (Modo Standalone)

Para iniciar o servidor com o arquivo `compose.yaml`:

```bash
docker compose up -d --build
```

O arquivo `compose.yaml`:
- Mapeia o diretório local `./data` para `/app/data` no contêiner, garantindo persistência dos arquivos JSON de contas, ordens, trades, preços e eventos.
- Configura limites de recursos (0.50 CPU e 512MB de memória).
- Expõe a porta do servidor para o host.

Para verificar os logs do contêiner:
```bash
docker compose logs -f
```

Para parar o contêiner:
```bash
docker compose down
```

---

## 4. Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto (use `env.example` como modelo) para personalizar o comportamento do servidor:

| Variável | Tipo | Padrão | Descrição |
| --- | --- | --- | --- |
| `MARKET_PORT` | Inteiro | `3001` | Porta TCP na qual o servidor HTTP receberá conexões. |
| `MARKET_STATE_FILE` | Caminho | `data/market-state.json` | Caminho do arquivo JSON de estado principal de mercado. |
| `MARKET_DATA_DIR` | Caminho | `data` | Diretório raiz onde residem as 8 coleções de dados persistidas. |
| `MARKET_LOG_DIRECTORY` | Caminho | `data/logs` | Diretório onde os arquivos de logs estruturados em JSON são gravados. |
| `MARKET_ADMIN_TOKEN` | String | *(Gerado dinamicamente)* | Token estático para a conta de administração do sistema. Se omitido, uma chave única é gerada e exibida no console a cada inicialização. |
| `TRUST_PROXY` | String | *(Desabilitado)* | Configuração do cabeçalho `trust proxy` do Express (ex: `loopback`, `127.0.0.1`, `linklocal` ou sub-redes confiáveis). |
| `MARKET_EVENT_MIN_INTERVAL_MS` | Inteiro | `60000` (60s) | Intervalo mínimo aleatório entre eventos macroeconômicos simulados (em milissegundos). |
| `MARKET_EVENT_MAX_INTERVAL_MS` | Inteiro | `120000` (120s) | Intervalo máximo aleatório entre eventos macroeconômicos simulados (em milissegundos). |
| `MARKET_SERVER_NAME` | String | *(Hostname)* | Nome de exibição da instância incluído em `meta.server.name` e nas mensagens de erro. |
| `MARKET_SYNC_ROLE` | String | `standalone` | Papel do servidor no cluster: `standalone`, `master` ou `node`. |
| `MARKET_SYNC_MASTER_URL` | URL | `""` | URL base do servidor Master (obrigatório se `MARKET_SYNC_ROLE=node`). |
| `MARKET_SYNC_TOKEN` | String | `""` | Chave secreta compartilhada entre nós e o master para autenticação do cabeçalho `X-Market-Sync-Token`. |
| `MARKET_NODE_ID` | String | *(Hostname)* | Identificador único deste nó perante o master. |
| `MARKET_NODE_PUBLIC_URL` | URL | `""` | URL pública acessível deste nó para atalho de navegação no master. |
| `MARKET_NODE_SYNC_MODE` | String | `bidirectional` | Modo de sincronização do nó: `bidirectional` (envia e recebe) ou `receive-only` (apenas recebe). |
| `MARKET_SYNC_INTERVAL_SECONDS` | Inteiro | `5` | Intervalo em segundos para reconciliação periódica com o master. |

---

## 5. Configuração de Proxy Reverso e Segurança

Se o servidor estiver hospedado atrás de um proxy reverso (Nginx, Traefik, Caddy, Cloudflare ou AWS ALB):

1. **Defina `TRUST_PROXY`**:
   O sistema utiliza o endereço IP do cliente para aplicar políticas de limitação de taxa (*rate limiting*). Se `TRUST_PROXY` não for configurado ou configurado de forma insegura, o rate limit poderá bloquear o IP do próprio proxy ou falhar.
   Exemplo no `.env`:
   ```env
   TRUST_PROXY=loopback
   ```
   > [!WARNING]
   > Nunca use `TRUST_PROXY=true` indiscriminadamente em redes abertas, pois isso permite que clientes forjem o cabeçalho `X-Forwarded-For`.

2. **Terminação SSL/TLS**:
   Em ambiente de produção, nunca exponha a API em HTTP puro. Termine o tráfego HTTPS no proxy reverso e encaminhe as requisições seguras ao servidor local.

---

## 6. Verificação e Testes

Para garantir a integridade dos dados e a consistência das operações financeiras e de concorrência:

- **Executar a suíte de testes automatizados**:
  ```bash
  npm test
  ```

- **Executar o script de migração de banco de dados**:
  ```bash
  npm run migrate
  ```

