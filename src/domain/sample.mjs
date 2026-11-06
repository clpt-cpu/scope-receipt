export const sampleProject = {
  name: 'Market Street Coffee · autumn print update', quote: 'Q-019', currency: 'USD',
  quoteSummary: 'Two menu boards and one revision round. Extra deliverables are priced separately.',
  notes: [
    'The agreed two menu boards are complete. This is part of quote Q-019.',
    'Client requested 2 additional poster layouts outside the quote, at $45 each.',
    'Sent the preview link and scheduled a review for Thursday.',
    'Client added 1 extra window sign, at $80.',
    'Corrected the spelling in the agreed menu board. Included revision.',
    'Waiting for the client to confirm print sizes.',
    'Please make the logo feel less busy.',
    'Client requested 3 more language variants outside the quote, at $30 each.',
  ].join('\n'),
  // The same project as client messages, the way they usually arrive. Used with the AI reader.
  thread: [
    'Delivered the two agreed menu boards from quote Q-019.',
    'Client (Mon): These look great! Could you also do 2 poster layouts for the front window? $45 each is fine.',
    'Sent the preview link and booked a review call for Thursday.',
    'Client (Thu): One more thing, we need a sidewalk sign too, and please fix the typo in the menu board heading. Our budget for the sign is $80.',
    'Fixed the heading typo on the agreed menu board. Included revision.',
    'Waiting for the client to confirm print sizes.',
    'Client: Can the logo feel a little less busy?',
    'Client (Fri): Could we get the menu in Spanish, French and Korean as well? $30 per language.',
  ].join('\n'),
};
