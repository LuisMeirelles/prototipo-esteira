// Emojis disponíveis no /emoji. Formato: "emoji palavras-chave" (busca ignora acentos e maiúsculas).
const RAW = `
😀 sorriso feliz alegre|😃 sorriso feliz|😄 riso alegre|😁 sorrindo dentes|😆 rindo|😅 suor alivio|🤣 rolando rindo kkk|😂 chorando de rir kkk|🙂 sorriso leve|🙃 de cabeça pra baixo|😉 piscadinha|😊 corado feliz|😇 anjo santo|🥰 apaixonado amor|😍 olhos de coracao apaixonado|🤩 deslumbrado estrela|😘 beijo|😗 beijinho|😚 beijo feliz|😋 delicioso gostoso|😛 lingua|😜 piscando lingua|🤪 maluco doido|😝 careta lingua|🤑 dinheiro|🤗 abraco|🤭 ops risadinha|🤫 silencio shh segredo|🤔 pensando duvida hmm|🤐 boca fechada|🤨 sobrancelha desconfiado|😐 neutro|😑 sem expressao|😶 sem boca|😏 sarcastico malandro|😒 desdem|🙄 revirando olhos|😬 constrangido|😮‍💨 suspiro alivio|🤥 mentiroso|😌 aliviado|😔 pensativo triste|😪 sonolento|🤤 babando|😴 dormindo sono|😷 mascara doente|🤒 febre doente|🤕 machucado|🤢 enjoado nojo|🤮 vomitando|🤧 espirro|🥵 calor quente|🥶 frio gelado|🥴 tonto|😵 tonto zonzo|🤯 cabeca explodindo mente|🤠 cowboy|🥳 festa comemorando|😎 oculos escuros legal|🤓 nerd|🧐 monoculo curioso|😕 confuso|😟 preocupado|🙁 triste|😮 surpreso boca aberta|😯 surpreso|😲 chocado|😳 envergonhado vermelho|🥺 por favor implorando|😦 chocado|😨 medo assustado|😰 ansioso suor|😥 triste aliviado|😢 chorando lagrima|😭 chorando muito|😱 grito susto|😖 frustrado|😣 sofrendo|😞 decepcionado|😓 suor cansado|😩 exausto cansado|😫 cansado|🥱 bocejo tedio|😤 bravo irritado|😡 raiva furioso|😠 bravo|🤬 xingando palavrao|😈 diabinho|👿 diabo bravo|💀 caveira morto|☠️ caveira perigo|💩 coco cocô|🤡 palhaco|👻 fantasma|👽 alien|🤖 robo|🎃 abobora halloween
👍 joia positivo curti ok|👎 negativo nao curti|👌 ok perfeito|🤌 italiano|✌️ paz vitoria|🤞 dedos cruzados sorte|🤟 amo voce|🤘 rock|🤙 me liga|👈 esquerda|👉 direita|👆 cima|👇 baixo|☝️ um cima|✋ mao parar|🖐️ mao aberta|🖖 vulcano|👋 tchau ola oi acenando|🤚 mao|👏 palmas aplausos parabens|🙌 maos para cima comemorando|👐 maos abertas|🤲 maos juntas|🤝 aperto de mao acordo|🙏 por favor obrigado rezando|✍️ escrevendo|💪 forte musculo forca|🦾 braco robotico|🧠 cerebro inteligencia|👀 olhos olhando|👁️ olho|👂 orelha|👃 nariz|👄 boca|🫶 coracao maos|🫡 continencia|🫠 derretendo|🫣 espiando|🫢 surpresa mao boca|🫰 estalo dedos|🤏 pouquinho
❤️ coracao amor vermelho|🧡 coracao laranja|💛 coracao amarelo|💚 coracao verde|💙 coracao azul|💜 coracao roxo|🖤 coracao preto|🤍 coracao branco|🤎 coracao marrom|💔 coracao partido|❣️ exclamacao coracao|💕 dois coracoes|💞 coracoes girando|💓 coracao batendo|💗 coracao crescendo|💖 coracao brilhante|💘 coracao flecha|💝 coracao presente|💯 cem 100 perfeito|💢 raiva|💥 explosao|💫 tontura estrela|💦 gotas agua|💨 vento correndo|💣 bomba|💬 balao fala conversa|💭 pensamento|💤 zzz sono
🎉 festa parabens comemoracao|🎊 confete|🎈 balao|🎁 presente|🏆 trofeu campeao|🥇 medalha ouro primeiro|🥈 medalha prata|🥉 medalha bronze|⭐ estrela|🌟 estrela brilhante|✨ brilho magico|⚡ raio energia|🔥 fogo quente incrivel|🌈 arco-iris|☀️ sol|🌙 lua|☁️ nuvem|🌧️ chuva|⛈️ tempestade|❄️ neve gelo|🌊 onda mar|🌍 mundo terra|🍀 trevo sorte|🌸 flor cerejeira|🌹 rosa|🌻 girassol|🌱 muda planta|🌳 arvore|🌵 cacto
🐶 cachorro cao|🐱 gato|🐭 rato|🐹 hamster|🐰 coelho|🦊 raposa|🐻 urso|🐼 panda|🐨 coala|🐯 tigre|🦁 leao|🐮 vaca|🐷 porco|🐸 sapo|🐵 macaco|🙈 macaco nao vejo|🙉 macaco nao ouco|🙊 macaco nao falo|🐔 galinha|🐧 pinguim|🐦 passaro|🦆 pato|🦉 coruja|🦄 unicornio|🐝 abelha|🦋 borboleta|🐌 caracol lento|🐞 joaninha|🐢 tartaruga|🐍 cobra|🐙 polvo|🐠 peixe|🐬 golfinho|🐳 baleia|🦈 tubarao|🐘 elefante|🦒 girafa|🐴 cavalo|🦖 dinossauro|🐛 bug inseto lagarta
🍎 maca|🍌 banana|🍉 melancia|🍇 uva|🍓 morango|🍍 abacaxi|🥑 abacate|🍅 tomate|🥕 cenoura|🌽 milho|🍕 pizza|🍔 hamburguer|🍟 batata frita|🌭 cachorro quente|🌮 taco|🍿 pipoca|🍞 pao|🧀 queijo|🥚 ovo|🥓 bacon|🍗 frango coxa|🍖 carne|🍣 sushi|🍜 macarrao lamen|🍝 espaguete|🍰 bolo|🎂 bolo aniversario|🍫 chocolate|🍩 donut rosquinha|🍪 biscoito|🍦 sorvete|🍺 cerveja|🍻 brinde cervejas|🍷 vinho|🥂 brinde taca|🍸 drink|☕ cafe|🍵 cha|🥤 refrigerante copo|🧃 suco|💧 gota agua
⚽ futebol bola|🏀 basquete|🏈 futebol americano|🎾 tenis|🏐 volei|🎮 videogame jogo|🕹️ joystick|🎲 dado|🧩 quebra-cabeca|🎯 alvo acerto|🎵 musica nota|🎶 musicas|🎧 fone musica|🎤 microfone|🎸 guitarra|🥁 bateria|🎬 cinema claquete|📷 camera foto|📺 televisao|🚗 carro|🚕 taxi|🚌 onibus|🚀 foguete lancamento|✈️ aviao|🚲 bicicleta|🏠 casa|🏢 predio escritorio
💻 computador notebook|🖥️ desktop|⌨️ teclado|🖱️ mouse|📱 celular|☎️ telefone|🔋 bateria|🔌 tomada|💡 ideia lampada|🔦 lanterna|📚 livros|📖 livro aberto|📝 anotacao nota|✏️ lapis|📌 alfinete fixado|📎 clipe anexo|✂️ tesoura|🔒 cadeado trancado|🔓 destrancado|🔑 chave|🔧 chave inglesa ferramenta|🔨 martelo|🛠️ ferramentas|⚙️ engrenagem configuracao|🧰 caixa de ferramentas|🔍 lupa busca|📧 email|📦 pacote caixa|📅 calendario|📈 grafico subindo|📉 grafico caindo|📊 grafico|💰 dinheiro saco|💵 dinheiro nota|💳 cartao|⏰ despertador alarme|⌛ ampulheta|🕐 relogio hora|🔔 sino notificacao|🔕 sino mudo|📣 megafone|📢 alto-falante anuncio|🧪 teste experimento|🔬 microscopio
✅ certo feito check pronto|❌ errado erro x|❎ x verde|⭕ circulo|❓ pergunta duvida|❗ exclamacao atencao|‼️ exclamacao dupla|⚠️ aviso cuidado|🚫 proibido|⛔ proibido entrada|🔴 circulo vermelho|🟠 circulo laranja|🟡 circulo amarelo|🟢 circulo verde|🔵 circulo azul|🟣 circulo roxo|⚫ circulo preto|⚪ circulo branco|➕ mais|➖ menos|➡️ seta direita|⬅️ seta esquerda|⬆️ seta cima|⬇️ seta baixo|🔄 atualizar recarregar|🔁 repetir|🆗 ok|🆕 novo|🆒 legal|🔝 topo|💲 cifrao|♻️ reciclar|🏁 bandeira chegada|🚩 bandeira vermelha|🇧🇷 brasil bandeira
`;

export const EMOJIS = RAW.split(/\n|\|/)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((line) => {
    const i = line.indexOf(' ');
    return { char: line.slice(0, i), keys: norm(line.slice(i + 1)) };
  });

export function norm(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function searchEmojis(query) {
  const q = norm(query.trim());
  if (!q) return EMOJIS;
  const words = q.split(/\s+/);
  return EMOJIS.filter((e) => words.every((w) => e.keys.includes(w)));
}
