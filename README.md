# Gantt Chart

Componente de **Gráfico de Gantt** para acompanhamento e gerenciamento visual de projetos.

## 1) O que é

Este repositório contém uma extração independente do componente de Gantt usado em produção no SIGEP, com foco em visualização hierárquica de tarefas e simulação de timeline.

## 2) Por que foi criado

O componente foi criado para suprir a necessidade de um Gantt funcional e reutilizável, sem depender de soluções pagas ou limitadas.

## 3) Demonstração

### Executar localmente

1. Entre na pasta do projeto:
   ```bash
   cd gantt-chart
   ```
2. Inicie um servidor estático na raiz do projeto:
   ```bash
   python -m http.server 8080
   ```
3. Abra no navegador:
   ```
   http://localhost:8080/demo/
   ```

### Demo online (GitHub Pages)

A estrutura está preparada para publicar a pasta `demo/` no GitHub Pages.

## 4) Funcionalidades existentes

Com base na implementação real extraída:

- Renderização hierárquica de tarefas (árvore pai/filho).
- Roll-up de datas dos níveis pai a partir dos descendentes.
- Expandir/Recolher níveis.
- Zoom de timeline (Dia, Semana, Mês, Trimestre, Ano).
- Ajuste de escala do gráfico (70% a 100%).
- Modo Timeline com play/pause/restart/finish.
- Velocidade da Timeline (1x, 5x, 10x, 20x, 50x, 100x).
- Indicadores de progresso e status (não iniciado, andamento, concluído, cancelado).
- Sinalização de atraso e vencimento próximo.
- Tooltip detalhado com responsáveis, integrantes, envolvidos e evidências.
- Avatares/fallback por iniciais.
- Sincronização de scroll entre grade e timeline.
- Atualização opcional via endpoint/SignalR (quando configurado em integração real).

## 5) Tecnologias

- HTML
- CSS
- JavaScript
- C# (DTO de referência para integração)

## 6) Instalação

Não há build obrigatório para a demo. Basta clonar o repositório e servir arquivos estáticos.

```bash
git clone <url-do-repositorio>
cd gantt-chart
python -m http.server 8080
```

## 7) Utilização

### Estrutura mínima de página

- Incluir `src/css/gantt-chart.css`
- Incluir `src/js/gantt-chart.js`
- Definir `window.tarefasBrutasMonitoramento` antes do script principal
- Criar os elementos com IDs esperados (`chartDivGantt`, `ganttToolbar`, `ganttViewToggle`, etc.)

### Exemplo de dados

```javascript
window.tarefasBrutasMonitoramento = [
  {
	Id: "nivel-1",
	ParentId: "",
	NomeOriginal: "Projeto de Demonstração",
	Start: "2026-01-01",
	End: "2026-01-31",
	OwnStart: "2026-01-01",
	OwnEnd: "2026-01-31",
	Progress: 40,
	Tipo: "Projeto",
	Situacao: "Em andamento",
	Codigo: "1",
	Marco: false,
	Responsaveis: ["Ana"],
	Integrantes: ["Bruno"],
	Pessoas: [{ Nome: "Ana", Responsavel: true, Foto: "" }],
	Envolvidos: []
  }
];
```

## 8) Configuração

Principais pontos configuráveis no JS:

- `ZOOM_LEVELS`: granularidade de visualização.
- `CHART_SCALE_PRESETS`: percentuais de escala.
- `TIMELINE_SPEEDS`: velocidades da timeline.
- `ROW_HEIGHT`: altura de linha.

## 9) Dados

A estrutura esperada pelo componente segue o contrato de `GanttTaskDto`:

- Identificação e hierarquia: `Id`, `ParentId`, `Codigo`.
- Datas: `Start`, `End`, `OwnStart`, `OwnEnd`, `DataEncerramento`.
- Estado: `Progress`, `Situacao`, `Tipo`, `Marco`.
- Contexto: `Evidencia`, `Responsaveis`, `Integrantes`, `Pessoas`, `Envolvidos`.

Referência C# em: `src/csharp/GanttTaskDto.cs`.

## 10) Licença

**Pendente de definição.**

Antes de publicar, escolha a licença do projeto e adicione o arquivo `LICENSE`.

### Opções comuns

- **MIT**: permissiva e simples, permite uso comercial e redistribuição com poucas restrições.
- **Apache-2.0**: também permissiva, inclui cláusulas explícitas de patente e requisitos adicionais de aviso.

Enquanto a licença não for definida, o ideal é não considerar o projeto oficialmente aberto para redistribuição.

---

## Estrutura

```text
gantt-chart/
├── README.md
├── .gitignore
├── demo/
│   ├── index.html
│   ├── css/demo.css
│   └── data/demo-data.js
├── src/
│   ├── css/gantt-chart.css
│   ├── js/gantt-chart.js
│   └── csharp/GanttTaskDto.cs
└── docs/
	└── extracao-tecnica.md
```
