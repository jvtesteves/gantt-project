#!/bin/bash

# 📊 Script de Monitoramento - Gantt Project
# Monitora saúde da aplicação e envia alertas

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"; }
success() { echo -e "${GREEN}✅ $1${NC}"; }
warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; }

# Carregar configurações
CONFIG_FILE="scripts/deploy.config"
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
fi

# Função para enviar notificação Slack
send_slack_alert() {
    local message="$1"
    local status="$2"
    
    if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
        local color="good"
        [[ "$status" == "error" ]] && color="danger"
        [[ "$status" == "warning" ]] && color="warning"
        
        curl -s -X POST -H 'Content-type: application/json' \
            --data "{\"attachments\":[{\"color\":\"$color\",\"text\":\"🚀 Gantt Project Monitor\\n$message\"}]}" \
            "$SLACK_WEBHOOK_URL" > /dev/null 2>&1
    fi
}

# Função para verificar saúde do serviço
check_service_health() {
    local service_name="$1"
    local url="$2"
    local timeout="${3:-10}"
    
    log "🔍 Verificando $service_name..."
    
    if curl -f -s --max-time "$timeout" "$url" > /dev/null; then
        success "$service_name OK"
        return 0
    else
        error "$service_name FALHOU"
        return 1
    fi
}

# Função para verificar uso de recursos no EC2
check_ec2_resources() {
    if [[ -z "$EC2_HOST" ]] || [[ -z "$EC2_KEY_PATH" ]]; then
        warning "Configurações do EC2 não encontradas"
        return 0
    fi
    
    log "📊 Verificando recursos do EC2..."
    
    # Script para executar no EC2
    local remote_script="
        # CPU Usage
        cpu_usage=\$(top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | cut -d'%' -f1)
        
        # Memory Usage
        mem_usage=\$(free | grep Mem | awk '{printf \"%.1f\", \$3/\$2 * 100.0}')
        
        # Disk Usage
        disk_usage=\$(df / | tail -1 | awk '{print \$5}' | cut -d'%' -f1)
        
        # Process check
        node_processes=\$(pgrep -f 'node server.js' | wc -l)
        
        echo \"CPU:\${cpu_usage}%,MEM:\${mem_usage}%,DISK:\${disk_usage}%,PROCESSES:\${node_processes}\"
    "
    
    local resources
    resources=$(ssh -i "$EC2_KEY_PATH" -o ConnectTimeout=10 "$EC2_USER@$EC2_HOST" "$remote_script" 2>/dev/null)
    
    if [[ -n "$resources" ]]; then
        IFS=',' read -r cpu mem disk processes <<< "$resources"
        
        success "Recursos EC2: $cpu | $mem | $disk | Node Processes: ${processes##*:}"
        
        # Alertas baseados em thresholds
        cpu_val=${cpu%:*}; cpu_val=${cpu_val#*:}
        mem_val=${mem%:*}; mem_val=${mem_val#*:}
        disk_val=${disk%:*}; disk_val=${disk_val#*:}
        proc_val=${processes##*:}
        
        [[ "${cpu_val%.*}" -gt 80 ]] && warning "CPU alta: $cpu"
        [[ "${mem_val%.*}" -gt 85 ]] && warning "Memória alta: $mem"
        [[ "${disk_val}" -gt 90 ]] && warning "Disco cheio: $disk"
        [[ "$proc_val" -eq 0 ]] && error "Processo Node.js não está rodando!"
        
    else
        error "Não foi possível obter métricas do EC2"
    fi
}

# Função para verificar logs de erro
check_error_logs() {
    if [[ -z "$EC2_HOST" ]] || [[ -z "$EC2_KEY_PATH" ]]; then
        return 0
    fi
    
    log "📋 Verificando logs de erro..."
    
    local errors
    errors=$(ssh -i "$EC2_KEY_PATH" -o ConnectTimeout=10 "$EC2_USER@$EC2_HOST" \
        "tail -50 /home/ec2-user/gantt-project/backend/server.log 2>/dev/null | grep -i 'error\|failed\|exception' | tail -5" 2>/dev/null || echo "")
    
    if [[ -n "$errors" ]]; then
        warning "Erros recentes encontrados:"
        echo "$errors"
        send_slack_alert "Erros detectados nos logs:\\n\`\`\`$errors\`\`\`" "warning"
    else
        success "Nenhum erro recente nos logs"
    fi
}

# Função principal de monitoramento
main_monitor() {
    log "🚀 Iniciando monitoramento do Gantt Project"
    
    local overall_status="ok"
    
    # URLs para verificar
    local frontend_url="http://${S3_BUCKET}.s3-website-${AWS_REGION}.amazonaws.com"
    [[ -n "$CLOUDFRONT_DOMAIN" ]] && frontend_url="https://$CLOUDFRONT_DOMAIN"
    
    local backend_url="http://${EC2_HOST}:3001/api/users"
    
    # Verificações
    if ! check_service_health "Frontend" "$frontend_url" 15; then
        overall_status="error"
        send_slack_alert "❌ Frontend não está acessível: $frontend_url" "error"
    fi
    
    if ! check_service_health "Backend API" "$backend_url" 10; then
        overall_status="error"
        send_slack_alert "❌ Backend API não está acessível: $backend_url" "error"
    fi
    
    # Verificar recursos (apenas se outros testes passaram)
    if [[ "$overall_status" == "ok" ]]; then
        check_ec2_resources
        check_error_logs
    fi
    
    # Relatório final
    echo ""
    if [[ "$overall_status" == "ok" ]]; then
        success "🎉 Todos os serviços estão operacionais"
        send_slack_alert "✅ Sistema operacional - Todos os serviços OK" "good"
    else
        error "❌ Problemas detectados no sistema"
    fi
    
    log "📊 Monitoramento concluído"
}

# Modo de uso
case "${1:-monitor}" in
    "monitor")
        main_monitor
        ;;
    "health")
        # Verificação rápida apenas
        backend_url="http://${EC2_HOST}:3001/api/users"
        if check_service_health "Backend API" "$backend_url" 5; then
            echo "healthy"
            exit 0
        else
            echo "unhealthy"
            exit 1
        fi
        ;;
    "resources")
        check_ec2_resources
        ;;
    "logs")
        check_error_logs
        ;;
    *)
        echo "Uso: $0 [monitor|health|resources|logs]"
        echo ""
        echo "  monitor   - Monitoramento completo (padrão)"
        echo "  health    - Verificação rápida de saúde"
        echo "  resources - Apenas recursos do EC2"
        echo "  logs      - Apenas verificação de logs"
        exit 1
        ;;
esac