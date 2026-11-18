import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, addPlayer, applyAction, shuffledDeck, viewFor, type Card } from '../lib/game.ts';

test('two decks contain two of each suited card, four jokers, and unique physical card identities', () => {
  const cards = shuffledDeck(2);
  assert.equal(cards.length, 108); assert.equal(new Set(cards.map(c => c.id)).size, 108);
  assert.equal(cards.filter(c => c.suit === 'joker').length, 4);
  for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) for (let rank = 1; rank <= 13; rank++) assert.equal(cards.filter(c => c.rank === rank && c.suit === suit).length, 2);
  const other = shuffledDeck(2); assert.ok(other.every(c => !cards.some(old => old.id === c.id)));
});
test('only the host can choose decks between games; changing resets ready and rematches retain the choice', () => {
  const g = newGame('AB12','a','Alex');
  for(let i=1;i<10;i++)addPlayer(g,String(i),`Friend ${i}`);
  g.players.forEach(p=>p.ready=true);
  assert.equal(viewFor(g,'a').decks,1);
  assert.throws(()=>applyAction(g,'1',{type:'set-decks',decks:2}),/Only the host/);
  assert.throws(()=>applyAction(g,'a',{type:'set-decks',decks:3 as never}),/one or two/);
  applyAction(g,'a',{type:'set-decks',decks:2});
  assert.ok(g.players.every(p=>!p.ready));
  for(const p of g.players)applyAction(g,p.id,{type:'ready'});
  applyAction(g,'a',{type:'start'});
  assert.equal(g.deck.length,68); assert.ok(g.players.every(p=>p.hand.length===4));
  assert.equal(viewFor(g,'1').decks,2);
  assert.throws(()=>applyAction(g,'a',{type:'set-decks',decks:1}),/between games/);
  g.phase='finished'; for(const p of g.players)applyAction(g,p.id,{type:'ready'});
  assert.equal(g.decks,2); assert.equal(g.deck.length,68);
});
test('a second physical copy cannot inherit a peek, flash or received-card permission', () => {
  const g = newGame('AB12','a','Alex'); addPlayer(g,'b','Blake');
  for(const p of g.players)applyAction(g,p.id,{type:'ready'});applyAction(g,'a',{type:'start'});
  for(const p of g.players){applyAction(g,p.id,{type:'reveal-initial'});applyAction(g,p.id,{type:'close-initial'});}
  g.active=0;
  const original:Card={rank:4,suit:'hearts',id:'original-copy'};
  g.players[0].hand[0]={...original,id:'other-copy'};
  g.power={rank:7,step:'view',reveals:[{target:{playerId:'a',slot:0},card:original}]};
  g.flash={target:{playerId:'a',slot:0},card:original,until:Date.now()+10000};
  assert.equal(viewFor(g,'a').players[0].hand[0]?.face,null);
  assert.ok(!JSON.stringify(viewFor(g,'b')).includes('other-copy'));
  g.power={rank:12,step:'received',reveals:[],received:[{target:{playerId:'a',slot:0},card:original}]};
  assert.deepEqual(viewFor(g,'a').power?.received,[]);
  assert.throws(()=>applyAction(g,'a',{type:'peek',target:{playerId:'a',slot:0}}),/may have moved/);
});
