# Arquivos de dados JSON

O simulador persiste os dados locais na pasta `data/`. Os oito arquivos abaixo formam a estrutura modular usada pelo servidor.

| Nome | Descrição | Como os dados são armazenados |
| --- | --- | --- |
| `accounts.json` | Contas dos usuários, incluindo identificador, nome de usuário, saldo e permissões. | Lista de objetos. Cada conta tem um `accountId` usado para relacioná-la às posições, ordens e negociações. A chave de API não é salva: somente seu hash (`keyHash`) é persistido. |
| `assets.json` | Cadastro dos ativos negociáveis e seus preços atuais. | Lista de objetos com `assetId`, símbolo, nome, preço e data da última atualização. O ativo padrão do simulador tem ID e símbolo `SIM`. |
| `portfolios.json` | Posição de cada conta em cada ativo. | Lista de objetos com `accountId`, `assetId`, quantidade, preço médio de compra e data de atualização. |
| `orders.json` | Registro das ordens enviadas ao simulador e seu resultado. | Lista de objetos, normalmente com status `FILLED`, contendo conta, ativo, lado (`BUY` ou `SELL`), quantidade, preço, total, impacto no preço e datas. |
| `trades.json` | Histórico oficial das negociações executadas. | Lista de objetos com identificadores da negociação e da ordem, conta, usuário, ativo, lado, quantidade, preço, total, impacto e data. É a fonte usada para compor o histórico de negociações. |
| `market-history.json` | Série histórica de preços do ativo ao longo do tempo. | Lista de pontos com ativo, sequência, preço e data/hora. A sequência identifica a ordem dos pontos. |
| `market-events.json` | Eventos simulados que influenciaram o mercado. | Lista de eventos com categoria, título, descrição, impacto percentual e data/hora da ocorrência. |
| `market-state.json` | Estado operacional atual do mercado. | Um único objeto com ativo, preço e sequência atuais, volumes total/de compra/de venda, último evento, previsão do próximo evento e data de atualização. |

## Formato e gravação

Os arquivos são JSON em UTF-8, formatados com indentação de dois espaços. Os sete arquivos de registros guardam listas; `market-state.json` guarda um objeto. Quando uma coleção ainda não existe, o servidor usa uma lista vazia como valor inicial; para o estado, usa um objeto.

Antes de gravar, o servidor valida a estrutura e escreve o conteúdo em um arquivo temporário. Em seguida, substitui o arquivo de destino por renomeação, reduzindo o risco de deixar um JSON parcialmente gravado. As gravações concorrentes são serializadas por arquivo dentro do processo. Essa proteção é individual: a atualização de vários arquivos não constitui uma transação única.

## Backups e outros arquivos

O diretório `data/backups/` guarda snapshots e cópias de segurança criadas antes de migrações ou restaurações. O backup exportado pela API reúne o estado persistido em um único JSON; ao restaurá-lo, as coleções são substituídas, não mescladas.

`users.bin`, caso esteja presente na pasta `data/`, não faz parte das oito coleções JSON descritas aqui. Os arquivos de backup também não são coleções ativas do simulador.

> `accounts.json` contém dados de contas e hashes de chaves de API. Proteja a pasta `data/` e os backups como dados sensíveis; não publique esses arquivos em repositórios ou hospedagem pública.