// Emojis disponíveis em :nome:. Formato: "emoji nome outras-palavras". O nome é único e em inglês (padrão
// Slack/GitHub, com _ no lugar de espaço); as outras palavras são apelidos e termos de busca.
const RAW = `
😀 grinning smile happy|😃 smiley happy|😄 smile happy joy|😁 grin teeth|😆 laughing satisfied|😅 sweat_smile relief|🤣 rofl lol rolling|😂 joy lol tears laughing|🙂 slight_smile|🙃 upside_down|😉 wink|😊 blush happy
😇 innocent angel halo|🥰 in_love hearts|😍 heart_eyes love|🤩 star_struck wow|😘 kissing_heart kiss|😗 kissing|😚 kissing_closed_eyes|😋 yum tasty delicious|😛 stuck_out_tongue|😜 wink_tongue|🤪 zany crazy|😝 squint_tongue
🤑 money_mouth|🤗 hugs hug|🤭 giggle oops hand_over_mouth|🤫 shush quiet secret|🤔 thinking hmm|🤐 zipper_mouth|🤨 raised_eyebrow suspicious|😐 neutral_face|😑 expressionless|😶 no_mouth|😏 smirk|😒 unamused
🙄 roll_eyes eyeroll|😬 grimacing grimace|😮‍💨 exhale sigh relieved|🤥 lying_face liar|😌 relieved|😔 pensive sad|😪 sleepy|🤤 drooling|😴 sleeping zzz|😷 mask sick|🤒 thermometer_face fever sick|🤕 head_bandage hurt
🤢 nauseated sick|🤮 vomiting|🤧 sneezing|🥵 hot_face|🥶 cold_face freezing|🥴 woozy|😵 dizzy_face|🤯 exploding_head mindblown|🤠 cowboy|🥳 partying party_face|😎 sunglasses cool|🤓 nerd
🧐 monocle curious|😕 confused|😟 worried|🙁 frowning sad|😮 open_mouth surprised|😯 hushed surprised|😲 astonished|😳 flushed embarrassed|🥺 pleading please|😦 frowning_open_mouth|😨 fearful scared|😰 anxious_sweat
😥 sad_relieved|😢 cry tear|😭 sob crying|😱 scream shocked|😖 confounded|😣 persevere struggling|😞 disappointed|😓 downcast_sweat|😩 weary|😫 tired|🥱 yawning bored|😤 triumph huffing
😡 rage angry mad|😠 angry_face|🤬 cursing swearing|😈 smiling_imp devil|👿 imp angry_devil|💀 skull dead|☠️ skull_crossbones danger|💩 poop poo|🤡 clown|👻 ghost|👽 alien|🤖 robot
🎃 jack_o_lantern halloween pumpkin|👍 thumbsup like +1 yes|👎 thumbsdown dislike -1 no|👌 ok_hand perfect|🤌 pinched_fingers italian|✌️ v peace victory|🤞 crossed_fingers luck|🤟 love_you_gesture|🤘 metal rock|🤙 call_me|👈 point_left|👉 point_right
👆 point_up_2|👇 point_down|☝️ point_up|✋ raised_hand stop|🖐️ hand_splayed|🖖 vulcan_salute|👋 wave hello bye|🤚 raised_back_of_hand|👏 clap applause|🙌 raised_hands praise|👐 open_hands|🤲 palms_up
🤝 handshake deal|🙏 pray thanks please|✍️ writing_hand|💪 muscle strong flex|🦾 mechanical_arm|🧠 brain|👀 eyes looking|👁️ eye|👂 ear|👃 nose|👄 lips mouth|🫶 heart_hands
🫡 salute|🫠 melting_face|🫣 peeking_eye|🫢 hand_over_mouth gasp|🫰 snap_fingers|🤏 pinching_hand little|❤️ heart red_heart love|🧡 orange_heart|💛 yellow_heart|💚 green_heart|💙 blue_heart|💜 purple_heart
🖤 black_heart|🤍 white_heart|🤎 brown_heart|💔 broken_heart|❣️ heart_exclamation|💕 two_hearts|💞 revolving_hearts|💓 heartbeat|💗 growing_heart|💖 sparkling_heart|💘 cupid arrow_heart|💝 gift_heart
💯 100 hundred perfect|💢 anger|💥 boom collision explosion|💫 dizzy stars|💦 sweat_drops water|💨 dash wind|💣 bomb|💬 speech_balloon chat|💭 thought_balloon|💤 zzz sleep|🎉 tada party celebrate|🎊 confetti_ball
🎈 balloon|🎁 gift present|🏆 trophy champion|🥇 first_place gold_medal|🥈 second_place silver_medal|🥉 third_place bronze_medal|⭐ star|🌟 star2 glowing_star|✨ sparkles magic|⚡ zap lightning energy|🔥 fire hot lit|🌈 rainbow
☀️ sun sunny|🌙 moon crescent|☁️ cloud|🌧️ rain|⛈️ thunder_storm|❄️ snowflake snow|🌊 ocean wave sea|🌍 earth_africa world globe|🍀 four_leaf_clover luck|🌸 cherry_blossom flower|🌹 rose|🌻 sunflower
🌱 seedling plant|🌳 tree|🌵 cactus|🐶 dog puppy|🐱 cat kitten|🐭 mouse_face|🐹 hamster|🐰 rabbit bunny|🦊 fox|🐻 bear|🐼 panda|🐨 koala
🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey_face|🙈 see_no_evil|🙉 hear_no_evil|🙊 speak_no_evil|🐔 chicken|🐧 penguin|🐦 bird
🦆 duck|🦉 owl|🦄 unicorn|🐝 bee honeybee|🦋 butterfly|🐌 snail slow|🐞 ladybug|🐢 turtle|🐍 snake|🐙 octopus|🐠 tropical_fish fish|🐬 dolphin
🐳 whale|🦈 shark|🐘 elephant|🦒 giraffe|🐴 horse|🦖 t_rex dinosaur|🐛 bug insect caterpillar|🍎 apple red_apple|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry
🍍 pineapple|🥑 avocado|🍅 tomato|🥕 carrot|🌽 corn|🍕 pizza|🍔 hamburger burger|🍟 fries|🌭 hotdog|🌮 taco|🍿 popcorn|🍞 bread
🧀 cheese|🥚 egg|🥓 bacon|🍗 poultry_leg chicken_leg|🍖 meat_on_bone|🍣 sushi|🍜 ramen noodles|🍝 spaghetti pasta|🍰 cake_slice shortcake|🎂 birthday_cake cake|🍫 chocolate_bar chocolate|🍩 doughnut donut
🍪 cookie|🍦 icecream ice_cream|🍺 beer|🍻 beers cheers|🍷 wine_glass wine|🥂 clinking_glasses champagne|🍸 cocktail drink|☕ coffee|🍵 tea|🥤 cup_with_straw soda|🧃 juice_box|💧 droplet water
⚽ soccer football|🏀 basketball|🏈 football american_football|🎾 tennis|🏐 volleyball|🎮 video_game gaming|🕹️ joystick|🎲 game_die dice|🧩 puzzle_piece|🎯 dart bullseye target|🎵 musical_note music|🎶 notes music
🎧 headphones|🎤 microphone mic|🎸 guitar|🥁 drum|🎬 clapper movie film|📷 camera photo|📺 tv television|🚗 car|🚕 taxi|🚌 bus|🚀 rocket launch|✈️ airplane plane
🚲 bike bicycle|🏠 house home|🏢 office building|💻 computer laptop|🖥️ desktop_computer|⌨️ keyboard|🖱️ computer_mouse|📱 iphone phone mobile|☎️ telephone|🔋 battery|🔌 electric_plug|💡 bulb idea light
🔦 flashlight|📚 books|📖 book open_book|📝 memo note pencil|✏️ pencil2|📌 pushpin pin|📎 paperclip|✂️ scissors|🔒 lock locked|🔓 unlock unlocked|🔑 key|🔧 wrench tool
🔨 hammer|🛠️ hammer_and_wrench tools|⚙️ gear settings|🧰 toolbox|🔍 mag search magnifying_glass|📧 email mail|📦 package box|📅 date calendar|📈 chart_with_upwards_trend growth|📉 chart_with_downwards_trend decline|📊 bar_chart chart|💰 moneybag money
💵 dollar cash|💳 credit_card|⏰ alarm_clock alarm|⌛ hourglass|🕐 clock1 time|🔔 bell notification|🔕 no_bell mute|📣 mega megaphone|📢 loudspeaker announcement|🧪 test_tube experiment|🔬 microscope|✅ white_check_mark check done
❌ x cross wrong|❎ negative_squared_cross_mark|⭕ o circle|❓ question|❗ exclamation attention|‼️ bangbang double_exclamation|⚠️ warning caution|🚫 no_entry_sign prohibited|⛔ no_entry|🔴 red_circle|🟠 orange_circle|🟡 yellow_circle
🟢 green_circle|🔵 blue_circle|🟣 purple_circle|⚫ black_circle|⚪ white_circle|➕ heavy_plus_sign plus|➖ heavy_minus_sign minus|➡️ arrow_right|⬅️ arrow_left|⬆️ arrow_up|⬇️ arrow_down|🔄 arrows_counterclockwise refresh reload
🔁 repeat|🆗 ok|🆕 new|🆒 cool_button|🔝 top|💲 heavy_dollar_sign|♻️ recycle|🏁 checkered_flag finish|🚩 triangular_flag red_flag|🇧🇷 flag_br brazil
`;

export function norm(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export const EMOJIS = RAW.split(/\n|\|/)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((line) => {
    const [char, name, ...more] = line.split(' ');
    // keys: o que a busca enxerga (com _ virando espaço); more: o que a lista mostra ao lado do nome
    const keys = [name, ...more].map((w) => w.replace(/_/g, ' ')).join(' ');
    return { char, name, more: more.join(' '), aliases: more, keys };
  });

/** Busca por nome ou termo; `_` vale como espaço. Nome que começa com o texto vem primeiro. */
export function searchEmojis(query) {
  const q = norm(query.replace(/_/g, ' ').trim());
  if (!q) return EMOJIS;
  const words = q.split(/\s+/);
  const rank = (e) => {
    const n = e.name.replace(/_/g, ' ');
    return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3;
  };
  return EMOJIS.filter((e) => words.every((w) => e.keys.includes(w)))
    .map((e) => [rank(e), e])
    .sort((a, b) => a[0] - b[0])
    .map((x) => x[1]);
}

/** Emoji para ":nome:" já fechado: pelo nome exato, ou por um apelido que só um emoji tem. Senão, null. */
export function exactEmoji(term) {
  const q = norm(term.trim());
  if (!q) return null;
  const byName = EMOJIS.find((e) => e.name === q);
  if (byName) return byName;
  const byAlias = EMOJIS.filter((e) => e.aliases.includes(q));
  return byAlias.length === 1 ? byAlias[0] : null;
}
