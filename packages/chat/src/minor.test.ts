import { describe, expect, it } from "vitest";
import { detectMinor, detectMinorIn } from "./minor";

describe("detectMinor : âge déclaré de moins de 18 ans (6 langues)", () => {
  const minors: [string, number | null][] = [
    // français
    ["j'ai 16 ans", 16],
    ["J'ai 15ans", 15],
    ["jai 17 ans et toi ?", 17],
    ["J’ai 14 ans", 14],
    ["16 ans", 16],
    ["16 ans et toi ?", 16],
    ["moi 16 ans", 16],
    ["Salut ! 15 ans, et toi ?", 15],
    ["moi j'ai 16 ans", 16],
    ["j'ai seize ans", 16],
    ["j'ai dix-sept ans", 17],
    ["j'ai eu 16 ans hier", 16],
    ["j'ai 16", 16],
    ["j'ai 15 lol", 15],
    ["g 16 ans", 16],
    ["je vais sur mes 17 ans", 17],
    ["j'ai bientôt 17 ans", 17],
    ["je suis mineure", null],
    ["je suis pas encore majeur", null],
    ["j'ai pas encore 18 ans", null],
    ["je n'ai pas 18 ans", null],
    ["j ai 17 piges", 17],
    ["j'ai 16 balais", 16],
    ["j'ai 16 maintenant", 16],
    ["j'ai 16 mtn", 16],
    ["j'ai 15 ptdr", 15],
    ["j'ai 16 hahaha", 16],
    ["j'ai 16 😊", 16],
    ["j'ai 16 :)", 16],
    ["j'ai 16, et toi ?", 16],
    ["j'ai 16.", 16],
    // suites courantes qui ne sont pas une durée (« mais », « en vrai », « du coup », « de toute façon »…)
    ["j'ai 16 ans mais je suis mature", 16],
    ["j'ai 16 ans en vrai", 16],
    ["j'ai 16 ans en fait", 16],
    ["j'ai 16 ans du coup", 16],
    ["j'ai 16 ans de toute façon", 16],
    ["16 ans mais chut", 16],
    ["16 ans en terminale", 16],
    ["moi j'ai 16 ans mais bon", 16],
    ["j'ai 16 ans que veux tu", 16],
    ["j'ai 16 en vrai", 16],
    // prénom + âge
    ["Lucas 16 ans", 16],
    ["moi c'est Lucas 16 ans", 16],
    ["salut moi c'est Inès, 15 ans", 15],
    ["je m'appelle Inès 15 ans", 15],
    // anglais
    ["I'm 16 btw", 16],
    ["I'm 16 now", 16],
    ["im 16 rn", 16],
    ["I'm 16!", 16],
    ["I'm 15", 15],
    ["im 16 and u?", 16],
    ["I am 17 years old", 17],
    ["i'm only 14", 14],
    ["17yo", 17],
    ["17yo here", 17],
    ["16 y/o", 16],
    ["age: 15", 15],
    ["I'm sixteen", 16],
    ["I just turned 16!", 16],
    ["I'm underage", null],
    ["i am a minor", null],
    ["I'm not 18 yet", null],
    ["I'm 16 in fact", 16],
    // espagnol
    ["tengo 16 años", 16],
    ["tengo 15", 15],
    ["Tengo quince años", 15],
    ["soy menor de edad", null],
    ["no tengo 18", null],
    ["tengo 16 años de edad", 16],
    // portugais
    ["tenho 16 anos", 16],
    ["eu tenho 15 anos e você?", 15],
    ["sou menor de idade", null],
    ["sou de menor", null],
    ["tenho 16 anos mas sou maduro", 16],
    // allemand
    ["ich bin 16", 16],
    ["Ich bin 16 Jahre alt", 16],
    ["ich bin sechzehn", 16],
    ["ich bin minderjährig", null],
    ["ich bin noch nicht 18", null],
    // italien
    ["ho 16 anni", 16],
    ["Ho 15 anni e tu?", 15],
    ["sono minorenne", null],
    ["non ho ancora 18 anni", null],
  ];

  it.each(minors)("« %s » → mineur", (text, age) => {
    const r = detectMinor(text);
    expect(r.minor).toBe(true);
    expect(r.age).toBe(age);
  });

  const notMinors = [
    // pas un âge
    "j'ai 16 ans d'expérience",
    "J'ai 15 ans de plus que toi",
    "16 ans de mariage, ça compte",
    "depuis 15 ans je vis à Lyon",
    "il y a 15 ans j'étais à Rome",
    "mon fils a 16 ans",
    "ma sœur, 16 ans, adore la danse",
    "quand j'avais 16 ans je faisais du skate",
    "à 16 ans je suis parti",
    "j'ai 12 chats",
    "j'ai 16h de cours demain",
    "rdv à 16h ?",
    "j'ai 2 enfants de 15 et 16 ans",
    "I'm 15 minutes away",
    "I'm 16km away",
    "I've been doing this for 15 years",
    "15 years ago I moved",
    "I'm 16 years older than her",
    "my sister is 16",
    "tengo 16 euros",
    "tengo 16 años de experiencia",
    "hace 15 años",
    "há 15 anos que moro aqui",
    "tenho 15 minutos",
    "ich bin seit 16 Jahren hier",
    "mein Sohn ist 16 Jahre alt",
    "ich bin 16 km entfernt",
    "ho 16 anni di esperienza",
    "sono qui da 15 anni",
    "ho 16 euro",
    // durées et lieux sans « j'ai » devant
    "16 ans que je vis ici",
    "Bah 16 ans que je bosse là-dedans",
    "Pendant 15 ans j'ai bossé à Lyon",
    "Depuis 16 ans je suis là",
    "15 years of marriage",
    "c'est dingue 15 ans qu'on se connait",
    "Fils 16 ans",
    "j'ai 15 en maths",
    // signes et unités après le nombre : jamais un âge
    "j'ai 15 € sur moi",
    "c'est payant ? j'ai que 15 €",
    "j'ai 12€",
    "j'ai 16 % de batterie",
    "I'm 15% sure",
    "j'ai 14:30 de libre",
    "j'ai 16/20 en maths",
    "j'ai 15.5 de moyenne",
    "j'ai 15,5 de moyenne",
    "j'ai 16 $",
    "Ok 15 j",
    "j'ai 15 d'avance",
    // adultes
    "j'ai 25 ans",
    "j'ai 18 ans",
    "J'ai 30 ans et toi ?",
    "I'm 21",
    "tengo 19 años",
    "ich bin 22",
    "ho 40 anni",
    "je ne suis pas mineure",
    "I'm not a minor",
    "I'm not underage",
    // sans rapport
    "",
    "Salut ça va ?",
    "Tu fais quoi ce soir ?",
  ];

  it.each(notMinors)("« %s » → pas mineur", (text) => {
    expect(detectMinor(text).minor).toBe(false);
  });

  it("detectMinorIn : premier message qui déclare un âge", () => {
    expect(detectMinorIn(["salut", "j'ai 15 ans"])).toEqual({ minor: true, age: 15 });
    expect(detectMinorIn(["salut", "j'ai 25 ans"])).toEqual({ minor: false, age: null });
  });
});
