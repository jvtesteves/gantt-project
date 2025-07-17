#!/bin/bash

# 🗄️ Script de Setup do RDS - Gantt Project
# Configura banco de dados PostgreSQL na AWS RDS

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"; }
success() { echo -e "${GREEN}✅ $1${NC}"; }
warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# Verificar se psql está instalado
if ! command -v psql &> /dev/null; then
    error "PostgreSQL client (psql) não encontrado. Instale com: sudo yum install postgresql15"
fi

# Verificar arquivo de configuração
CONFIG_FILE="scripts/deploy.config"
if [[ ! -f "$CONFIG_FILE" ]]; then
    error "Arquivo de configuração não encontrado: $CONFIG_FILE"
fi

source "$CONFIG_FILE"

# Verificar variáveis do RDS
required_vars=("RDS_ENDPOINT" "RDS_PORT" "RDS_DB_NAME" "RDS_USERNAME" "RDS_PASSWORD")
for var in "${required_vars[@]}"; do
    if [[ -z "${!var}" ]]; then
        error "Variável obrigatória não definida: $var"
    fi
done

log "🗄️ Configurando banco RDS: $RDS_ENDPOINT"

# Teste de conectividade
log "🔍 Testando conectividade com RDS..."
export PGPASSWORD="$RDS_PASSWORD"

if ! psql -h "$RDS_ENDPOINT" -p "$RDS_PORT" -U "$RDS_USERNAME" -d postgres -c "SELECT 1;" > /dev/null 2>&1; then
    error "Não foi possível conectar ao RDS. Verifique as configurações e Security Groups."
fi

success "Conectividade com RDS OK"

# Verificar se banco existe
log "🔍 Verificando se banco '$RDS_DB_NAME' existe..."
DB_EXISTS=$(psql -h "$RDS_ENDPOINT" -p "$RDS_PORT" -U "$RDS_USERNAME" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$RDS_DB_NAME';" 2>/dev/null || echo "")

if [[ -z "$DB_EXISTS" ]]; then
    log "📦 Criando banco '$RDS_DB_NAME'..."
    psql -h "$RDS_ENDPOINT" -p "$RDS_PORT" -U "$RDS_USERNAME" -d postgres -c "CREATE DATABASE $RDS_DB_NAME;" || error "Falha ao criar banco"
    success "Banco '$RDS_DB_NAME' criado"
else
    warning "Banco '$RDS_DB_NAME' já existe"
fi

# Executar script SQL
log "🏗️ Executando script de setup das tabelas..."
if [[ -f "setup.sql" ]]; then
    psql -h "$RDS_ENDPOINT" -p "$RDS_PORT" -U "$RDS_USERNAME" -d "$RDS_DB_NAME" -f setup.sql || error "Falha ao executar setup.sql"
    success "Tabelas criadas com sucesso"
else
    error "Arquivo setup.sql não encontrado"
fi

# Verificar se tabelas foram criadas
log "🔍 Verificando tabelas criadas..."
TABLES=$(psql -h "$RDS_ENDPOINT" -p "$RDS_PORT" -U "$RDS_USERNAME" -d "$RDS_DB_NAME" -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public';" 2>/dev/null)

if echo "$TABLES" | grep -q "tasks" && echo "$TABLES" | grep -q "users"; then
    success "Tabelas 'tasks' e 'users' criadas com sucesso"
else
    error "Tabelas não foram criadas corretamente"
fi

# Verificar dados iniciais
log "🔍 Verificando dados iniciais..."
USER_COUNT=$(psql -h "$RDS_ENDPOINT" -p "$RDS_PORT" -U "$RDS_USERNAME" -d "$RDS_DB_NAME" -tAc "SELECT COUNT(*) FROM users;" 2>/dev/null)

if [[ "$USER_COUNT" -gt 0 ]]; then
    success "$USER_COUNT usuários inseridos"
else
    warning "Nenhum usuário encontrado na tabela"
fi

# Gerar arquivo .env para o backend
log "📝 Gerando arquivo .env para o backend..."
ENV_FILE="backend/.env.production"
cat > "$ENV_FILE" << EOF
# Configurações de Produção - Gerado automaticamente
DB_HOST=$RDS_ENDPOINT
DB_PORT=$RDS_PORT
DB_NAME=$RDS_DB_NAME
DB_USER=$RDS_USERNAME
DB_PASSWORD=$RDS_PASSWORD
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://${CLOUDFRONT_DOMAIN:-$S3_BUCKET.s3-website-$AWS_REGION.amazonaws.com}
EOF

success "Arquivo .env.production criado: $ENV_FILE"

# Teste final
log "🧪 Teste final de conectividade..."
psql -h "$RDS_ENDPOINT" -p "$RDS_PORT" -U "$RDS_USERNAME" -d "$RDS_DB_NAME" -c "SELECT name FROM users LIMIT 3;" || error "Falha no teste final"

echo ""
success "🎉 Setup do RDS concluído com sucesso!"
echo "📊 Endpoint: $RDS_ENDPOINT"
echo "🗄️ Banco: $RDS_DB_NAME"
echo "📁 Arquivo de configuração: $ENV_FILE"
echo ""
log "📋 Próximos passos:"
echo "  1. Copie o arquivo $ENV_FILE para o servidor EC2"
echo "  2. Execute o deploy: ./scripts/deploy.sh"
echo "  3. Teste a aplicação"

# Limpar variável de senha
unset PGPASSWORD