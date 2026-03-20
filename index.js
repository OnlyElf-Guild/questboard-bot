function buildBoardText(open, claimed, confirm) {
  let text = "";

  text += "╔════════ **Anschlagbrett** ════════╗\n";
  if (!open.length) {
    text += "_Zur Zeit haengt kein neuer Auftrag aus._\n";
  } else {
    open.forEach(q => {
      const creator = q.guild_created ? "Die Gilde" : q.created_by_name;
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Belohnung: ${q.reward || "keine"}\n`;
      text += `Ausgehängt von: ${creator}\n\n`;
    });
  }
  text += "╚═══════════════════════════════════╝\n\n";

  text += "╔════════ **Auf Reisen** ═══════════╗\n";
  if (!claimed.length) {
    text += "_Derzeit ist kein Abenteurer ausgesandt._\n";
  } else {
    claimed.forEach(q => {
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Abenteurer: ${q.claimed_by_name}\n\n`;
    });
  }
  text += "╚═══════════════════════════════════╝\n\n";

  text += "╔════════ **Zur Abnahme** ══════════╗\n";
  if (!confirm.length) {
    text += "_Keine Rueckkehr wartet auf Bestaetigung._\n";
  } else {
    confirm.forEach(q => {
      text += `**#${q.id}**  ${q.amount}x ${q.title}\n`;
      text += `Abgegeben von: ${q.claimed_by_name}\n`;
      text += `Wartet auf Bestaetigung\n\n`;
    });
  }
  text += "╚═══════════════════════════════════╝";

  return text;
}
