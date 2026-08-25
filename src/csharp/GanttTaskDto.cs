using System.Collections.Generic;

namespace GanttChart
{
    public class GanttTaskDto
    {
        public string Id { get; set; }
        public string ParentId { get; set; }
        public string NomeExibicao { get; set; }
        public string NomeOriginal { get; set; }
        public string Start { get; set; }
        public string End { get; set; }
        public string OwnStart { get; set; }
        public string OwnEnd { get; set; }
        public string DataEncerramento { get; set; }
        public int Progress { get; set; }
        public string CustomClass { get; set; }
        public string Cor { get; set; }
        public string Tipo { get; set; }
        public string Situacao { get; set; }
        public int Profundidade { get; set; }
        public string Codigo { get; set; }
        public int Dias { get; set; }
        public bool Marco { get; set; }
        public string Evidencia { get; set; }
        public List<string> Responsaveis { get; set; } = new List<string>();
        public List<string> Integrantes { get; set; } = new List<string>();
        public List<GanttPessoaDto> Pessoas { get; set; } = new List<GanttPessoaDto>();
        public List<GanttPessoaDto> Envolvidos { get; set; } = new List<GanttPessoaDto>();
    }

    public class GanttPessoaDto
    {
        public string Nome { get; set; }
        public string Cpf { get; set; }
        public bool Responsavel { get; set; }
    }
}
