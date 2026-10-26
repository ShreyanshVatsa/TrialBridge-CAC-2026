import { describe, expect, it } from "vitest";
import { LOCALES } from "@/config/locales";
import { LEXICONS } from "@/lib/safety/lexicons";
import { crisisLocaleTags, matchesCrisis, normalizeForCrisis } from "@/lib/safety/crisis";
import { compilePattern } from "@/lib/safety/normalize";
import { detectCrisisLocal } from "@/lib/api/crisis";
import { detectCrisis, normalizeForSafety } from "@/functions/lib/safety";

/** Positive (crisis) and negative (ordinary trial question) phrases per locale. */
const CASES: Record<string, { pos: string[]; neg: string[]; min: number }> = {
  en: {
    min: 15,
    pos: [
      "I want to kill myself", "I'm thinking about suicide", "I am suicidal", "I want to end my life", "I wish I were dead",
      "I don't want to live anymore", "I don’t want to be here anymore", "there is no reason to live", "what's the point of living",
      "I might overdose on my pills", "I keep wanting to hurt myself", "self-harm", "everyone would be better off without me",
      "I can't go on", "I want to die", "I'm going to take my own life",
    ],
    neg: [
      "Can people who had radiation before join?", "Do I need to fast before the blood draw?", "Is parking free at the site?",
      "What is the end date of this study?", "How long is the trial life cycle?", "Will the study drug be an overdose risk?",
      "What are the side effects of the drug?", "Can I take my vitamins during the trial?", "Where is the nearest site?",
      "What does the placebo contain?", "How often are the visits?", "Is travel covered?", "Who is the trial contact?",
      "Does the trial accept people with diabetes?", "How many people will be in the study?", "What is the main goal of this trial?",
    ],
  },
  es: {
    min: 15,
    pos: [
      "quiero quitarme la vida", "Estoy pensando en el suicidio", "quiero morir", "no quiero seguir viviendo", "quiero acabar con mi vida",
      "me quiero matar", "ya no quiero estar aquí", "mejor muerto", "ojalá estuviera muerta", "quiero hacerme daño", "no vale la pena vivir",
      "tomé una sobredosis", "Quiero desaparecer", "voy a terminar con mi vida", "no tiene sentido vivir", "pienso en suicidarme",
    ],
    neg: [
      "¿Puedo participar si tomo medicamentos para la presión?", "¿Cuál es la fecha de fin del estudio?", "¿Hay estacionamiento gratis?",
      "¿Qué efectos secundarios tiene el medicamento?", "¿Cuántas visitas hay?", "¿Quién es el contacto del estudio?",
      "¿Se cubre el transporte?", "¿Qué se está probando en este estudio?", "¿Puedo tomar vitaminas durante el estudio?",
      "¿Dónde está el centro más cercano?", "¿Aceptan personas con diabetes?", "¿Cuánto dura el tratamiento?", "¿Es seguro este fármaco?",
      "¿Cuántas personas participan?", "¿Hay que ir en ayunas?", "¿Cuáles son los requisitos de edad?",
    ],
  },
  pt: {
    min: 15,
    pos: [
      "Estou pensando em suicídio", "estou pensando em suicidio", "quero acabar com a minha vida", "Eu quero morrer", "não quero mais viver",
      "vou me matar", "quero tirar minha vida", "melhor morta", "quero acabar com tudo", "vou me machucar", "não vale a pena viver",
      "tomei uma overdose", "nao aguento mais viver", "pensando em automutilação", "quero desaparecer", "acabar com minha vida",
    ],
    neg: [
      "Posso participar se já fiz quimioterapia?", "Qual é a data final do estudo?", "O estacionamento é gratuito?",
      "Quais são os efeitos colaterais do medicamento?", "Quantas visitas são necessárias?", "Quem é o contato do estudo?",
      "O transporte é coberto?", "O que está sendo testado neste estudo?", "Posso tomar vitaminas durante o estudo?",
      "Onde fica o centro mais próximo?", "Aceitam pessoas com diabetes?", "Quanto tempo dura o tratamento?", "Este medicamento é seguro?",
      "Quantas pessoas participam?", "Preciso estar em jejum?", "Qual é a idade mínima?",
    ],
  },
  ht: {
    min: 15,
    pos: [
      "mwen ap panse swisid", "Mwen vle touye tèt mwen", "mwen vle touye tet mwen", "mwen pa vle viv ankò", "mwen vle mouri",
      "mwen vle fini ak lavi mwen", "mwen pral met fen nan lavi mwen", "pi bon mwen mouri", "mwen vle swisid", "mwen ta renmen mouri",
      "fè tèt mwen mal", "mwen pa anvi viv", "mwen pral touye mwen", "overdoz", "pran lavi mwen", "mwen vle fini ak tout bagay",
    ],
    neg: [
      "Eske m ka patisipe si m te fè chirijri?", "Ki dat etid la fini?", "Èske gen estasyonman gratis?", "Ki efè segondè medikaman an gen?",
      "Konbyen vizit gen?", "Kiyès ki kontak etid la?", "Èske yo peye transpò?", "Kisa y ap teste nan etid sa a?", "Èske m ka pran vitamin?",
      "Ki kote sant ki pi pre a ye?", "Èske yo aksepte moun ki gen dyabèt?", "Konbyen tan tretman an dire?", "Èske medikaman sa a an sekirite?",
      "Konbyen moun ap patisipe?", "Èske m dwe pa manje anvan?", "Ki laj minimòm nan?",
    ],
  },
  fr: {
    min: 8,
    pos: ["je veux mourir", "je pense au suicide", "je veux me tuer", "j'en ai marre de vivre", "je ne veux plus vivre", "mettre fin à mes jours", "je veux me faire du mal", "ce serait mieux sans moi"],
    neg: ["Puis-je participer si j'ai déjà eu une chimiothérapie ?", "Quelle est la date de fin de l'étude ?", "Le parking est-il gratuit ?", "Quels sont les effets secondaires ?", "Combien de visites ?", "Qui est le contact de l'essai ?", "Le transport est-il remboursé ?", "Que teste cette étude ?"],
  },
  vi: {
    min: 8,
    pos: ["tôi muốn chết", "tôi đang nghĩ đến tự tử", "tôi không muốn sống nữa", "tôi muốn kết thúc cuộc đời", "tôi muốn tự sát", "tôi muốn giết bản thân", "tôi muốn tự làm hại mình", "tôi đã uống quá liều"],
    neg: ["Tôi có thể tham gia nếu đã hóa trị không?", "Ngày kết thúc nghiên cứu là khi nào?", "Bãi đậu xe có miễn phí không?", "Thuốc có tác dụng phụ gì?", "Có bao nhiêu lần khám?", "Ai là người liên hệ của nghiên cứu?", "Có hỗ trợ chi phí đi lại không?", "Nghiên cứu này thử nghiệm điều gì?"],
  },
  tl: {
    min: 8,
    pos: ["gusto kong mamatay", "iniisip ko ang magpakamatay", "ayaw ko nang mabuhay", "gusto kong wakasan ang buhay ko", "papatayin ko ang sarili ko", "gusto kong saktan ang sarili ko", "mas mabuti pang mamatay", "nag-overdose ako"],
    neg: ["Puwede ba akong sumali kung nagpa-chemo na ako?", "Kailan matatapos ang pag-aaral?", "Libre ba ang paradahan?", "Ano ang mga side effect ng gamot?", "Ilang beses ang pagbisita?", "Sino ang makokontak sa pag-aaral?", "Sagot ba ang pamasahe?", "Ano ang sinusubukan sa pag-aaral na ito?"],
  },
  ru: {
    min: 8,
    pos: ["я хочу умереть", "думаю о самоубийстве", "я не хочу больше жить", "хочу покончить с собой", "я хочу убить себя", "нет смысла жить", "хочу причинить себе вред", "у меня была передозировка"],
    neg: ["Могу ли я участвовать, если мне делали химиотерапию?", "Когда заканчивается исследование?", "Парковка бесплатная?", "Какие побочные эффекты у препарата?", "Сколько визитов нужно?", "Кто контактное лицо исследования?", "Оплачивается ли проезд?", "Что проверяется в этом исследовании?"],
  },
  "zh-Hans": {
    min: 8,
    pos: ["我想自杀", "我不想活了", "我想结束自己的生命", "我活不下去了", "我想死", "我想轻生", "我想自残", "我吃了过量的药想结束一切"],
    neg: ["我做过化疗还能参加吗？", "研究的结束日期是什么时候？", "停车免费吗？", "这种药有什么副作用？", "需要来几次？", "谁是研究联系人？", "交通费用报销吗？", "这项研究在测试什么？"],
  },
  "zh-Hant": {
    min: 8,
    pos: ["我想自殺", "我不想活了", "我想結束自己的生命", "我活不下去了", "我想死", "我想輕生", "我想自殘", "我吃了過量服藥想結束一切"],
    neg: ["我做過化療還能參加嗎？", "研究的結束日期是什麼時候？", "停車免費嗎？", "這種藥有什麼副作用？", "需要來幾次？", "誰是研究聯絡人？", "交通費用有補助嗎？", "這項研究在測試什麼？"],
  },
  ko: {
    min: 8,
    pos: ["자살하고 싶어요", "죽고 싶어요", "더 이상 살고 싶지 않아요", "삶을 끝내고 싶어요", "스스로 목숨을 끊고 싶어요", "자해하고 싶어요", "극단적 선택을 생각해요", "약을 과다 복용했어요"],
    neg: ["항암 치료를 받았는데 참여할 수 있나요?", "임상시험 종료일이 언제인가요?", "주차는 무료인가요?", "이 약의 부작용은 무엇인가요?", "방문은 몇 번인가요?", "연락 담당자는 누구인가요?", "교통비를 지원하나요?", "이 연구는 무엇을 시험하나요?"],
  },
  ar: {
    min: 8,
    pos: ["أفكر في الانتحار", "أريد أن أموت", "أريد أن أنهي حياتي", "لا أريد أن أعيش", "سأقتل نفسي", "أريد إيذاء نفسي", "تناولت جرعة زائدة", "لا فائدة من الحياة"],
    neg: ["هل يمكنني المشاركة إذا تلقيت علاجا كيميائيا؟", "ما هو تاريخ انتهاء الدراسة؟", "هل موقف السيارات مجاني؟", "ما الآثار الجانبية للدواء؟", "كم عدد الزيارات؟", "من هو جهة الاتصال للدراسة؟", "هل تُغطى تكاليف السفر؟", "ماذا تختبر هذه الدراسة؟"],
  },
  hi: {
    min: 8,
    pos: ["मैं आत्महत्या करना चाहता हूँ", "मैं मरना चाहता हूं", "मैं जीना नहीं चाहता", "मेरा जीने का मन नहीं है", "मैं अपनी जान ले लूंगा", "मैं खुद को नुकसान पहुँचाना चाहता हूँ", "मैंने ओवरडोज़ ले ली", "जीने का कोई मतलब नहीं"],
    neg: ["क्या कीमोथेरेपी के बाद मैं भाग ले सकता हूँ?", "अध्ययन की समाप्ति तिथि क्या है?", "क्या पार्किंग मुफ़्त है?", "दवा के दुष्प्रभाव क्या हैं?", "कितनी बार आना होगा?", "अध्ययन का संपर्क कौन है?", "क्या यात्रा का खर्च मिलता है?", "यह अध्ययन क्या परख रहा है?"],
  },
};

describe("crisis lexicons", () => {
  it("has a lexicon for every locale in the registry", () => {
    expect(crisisLocaleTags().sort()).toEqual(LOCALES.map((l) => l.tag).sort());
    expect(Object.keys(CASES).sort()).toEqual(LOCALES.map((l) => l.tag).sort());
  });

  it("only marks a lexicon reviewed after human review (none are)", () => {
    for (const l of Object.values(LEXICONS)) expect(l.reviewed).toBe(false);
    for (const l of LOCALES.filter((x) => x.tag !== "en")) expect(l.crisisLexicon).toBe(false);
  });

  for (const [tag, c] of Object.entries(CASES)) {
    describe(tag, () => {
      it(`has at least ${c.min} positive and ${c.min} negative phrases`, () => {
        expect(c.pos.length).toBeGreaterThanOrEqual(c.min);
        expect(c.neg.length).toBeGreaterThanOrEqual(c.min);
      });
      it.each(c.pos)("flags (own lexicon): %s", (text) => {
        expect(matchesCrisis(text, tag)).toBe(true);
      });
      it.each(c.pos)("flags (all lexicons, client + server): %s", (text) => {
        expect(detectCrisisLocal(text)).toBe(true);
        expect(detectCrisis(text)).toBe(true);
      });
      it.each(c.neg)("does not flag: %s", (text) => {
        expect(matchesCrisis(text)).toBe(false);
      });
    });
  }

  it("matches accent-insensitively", () => {
    for (const [a, b] of [["suicídio", "suicidio"], ["¡Quiero quitarme la vida!", "quiero quitarme la vida"], ["je veux mourir", "JE VEUX MOURIR"], ["ayúdame, quiero morirme", "ayudame quiero morirme"]] as const) {
      expect(matchesCrisis(a)).toBe(true);
      expect(matchesCrisis(b)).toBe(true);
    }
    expect(normalizeForCrisis("Café’s ÉÀ  x")).toBe("cafe's ea x");
    expect(normalizeForSafety("Ñandú")).toBe("nandu");
  });

  it("folds Arabic-script spellings (vowel marks, alef and yeh variants)", () => {
    expect(matchesCrisis("أُريدُ أَنْ أَمُوتَ")).toBe(true);
    expect(matchesCrisis("اريد ان اموت")).toBe(true);
    expect(normalizeForCrisis("كِتَابـــ")).toBe("كتاب");
  });

  it("falls back to every lexicon: an English phrase inside another language still triggers", () => {
    for (const prefix of ["هذا السؤال: ", "这是我的问题：", "Мой вопрос: ", "मेरा सवाल: ", "unsupported-locale text — "]) {
      expect(matchesCrisis(`${prefix}I want to end my life`)).toBe(true);
    }
    expect(matchesCrisis("Ordinary question about eligibility rules")).toBe(false);
    expect(matchesCrisis("")).toBe(false);
  });

  it("compiles patterns without stateful flags", () => {
    const re = compilePattern(/Suicid/gi);
    expect(re.global).toBe(false);
    expect(re.flags).toContain("i");
    expect(re.test("suicidal")).toBe(true);
    expect(re.test("suicidal")).toBe(true);
  });
});
