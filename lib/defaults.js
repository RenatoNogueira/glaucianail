// Catálogo inicial de serviços (usado na primeira execução e na migração de dados antigos)
module.exports.DEFAULT_SERVICES = [
  { id: 'manicure', nome: 'Manicure', minutos: 60, preco: 35, icone: '💅', ativo: true },
  { id: 'pedicure', nome: 'Pé de curi (Pedicure)', minutos: 60, preco: 40, icone: '🦶', ativo: true },
  { id: 'combo', nome: 'Manicure + Pedicure', minutos: 120, preco: 70, icone: '🌸', ativo: true },
  { id: 'esmaltacao', nome: 'Esmaltação em gel', minutos: 90, preco: 80, icone: '✨', ativo: true },
];
