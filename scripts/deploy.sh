#!/bin/bash

# 🚀 Script de Deploy Automatizado - Gantt Project
# Uso: ./scripts/deploy.sh

set -e  # Para na primeira falha

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para logs
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

# Verificar se arquivo de configuração existe
CONFIG_FILE="scripts/deploy.config"
if [[ ! -f "$CONFIG_FILE" ]]; then
    error "Arquivo de configuração não encontrado: $CONFIG_FILE"
fi

# Carregar configurações
source "$CONFIG_FILE"

# Verificar variáveis obrigatórias
required_vars=("EC2_HOST" "EC2_USER" "EC2_KEY_PATH" "S3_BUCKET" "AWS_REGION")
for var in "${required_vars[@]}"; do
    if [[ -z "${!var}" ]]; then
        error "Variável obrigatória não definida: $var"
    fi
done

log "🚀 Iniciando deploy do Gantt Project"
log "📊 Backend: $EC2_HOST"
log "🌐 Frontend: s3://$S3_BUCKET"

# 1. BUILD DO FRONTEND
log "📦 Fazendo build do frontend..."
npm run build || error "Falha no build do frontend"
success "Build do frontend concluído"

# 2. DEPLOY DO FRONTEND PARA S3
log "☁️  Enviando frontend para S3..."
aws s3 sync build/ s3://$S3_BUCKET --delete --region $AWS_REGION || error "Falha no upload para S3"
success "Frontend deployado no S3"

# 3. INVALIDAR CLOUDFRONT (se configurado)
if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    log "🔄 Invalidando cache do CloudFront..."
    aws cloudfront create-invalidation \
        --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
        --paths "/*" \
        --region $AWS_REGION || warning "Falha na invalidação do CloudFront"
    success "Cache do CloudFront invalidado"
fi

# 4. DEPLOY DO BACKEND NO EC2
log "🖥️  Deployando backend no EC2..."

# Criar script temporário para execução remota
REMOTE_SCRIPT="/tmp/deploy_backend_$(date +%s).sh"
cat > $REMOTE_SCRIPT << 'EOF'
#!/bin/bash
set -e

echo "📡 Atualizando código no servidor..."
cd /home/ec2-user/gantt-project
git pull origin main

echo "📦 Instalando dependências..."
cd backend
npm install

echo "🔄 Reiniciando servidor..."
# Parar processo anterior (se existir)
pkill -f "node server.js" || true
sleep 2

# Iniciar novo processo
nohup npm start > server.log 2>&1 &
sleep 3

# Verificar se está rodando
if pgrep -f "node server.js" > /dev/null; then
    echo "✅ Servidor backend está rodando"
    # Teste da API
    curl -f http://localhost:3001/api/users > /dev/null && echo "✅ API respondendo" || echo "❌ API não responde"
else
    echo "❌ Falha ao iniciar servidor"
    exit 1
fi
EOF

# Copiar e executar script no EC2
scp -i "$EC2_KEY_PATH" "$REMOTE_SCRIPT" "$EC2_USER@$EC2_HOST:/tmp/"
ssh -i "$EC2_KEY_PATH" "$EC2_USER@$EC2_HOST" "chmod +x /tmp/$(basename $REMOTE_SCRIPT) && /tmp/$(basename $REMOTE_SCRIPT)"

# Limpar arquivo temporário
rm "$REMOTE_SCRIPT"

success "Backend deployado no EC2"

# 5. TESTE FINAL
log "🧪 Executando testes finais..."

# Verificar se API está acessível externamente
API_URL="http://$EC2_HOST:3001/api/users"
if curl -f -s "$API_URL" > /dev/null; then
    success "API externa acessível"
else
    warning "API externa não acessível. Verifique Security Groups."
fi

# URL final
FRONTEND_URL="http://$S3_BUCKET.s3-website-$AWS_REGION.amazonaws.com"
if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    FRONTEND_URL="https://$CLOUDFRONT_DOMAIN"
fi

echo ""
success "🎉 Deploy concluído com sucesso!"
echo "🌐 Frontend: $FRONTEND_URL"
echo "📡 Backend: http://$EC2_HOST:3001"
echo ""
log "📋 Próximos passos:"
echo "  1. Acesse $FRONTEND_URL"
echo "  2. Teste login e criação de tarefas"
echo "  3. Monitore logs: ssh -i $EC2_KEY_PATH $EC2_USER@$EC2_HOST 'tail -f /home/ec2-user/gantt-project/backend/server.log'"