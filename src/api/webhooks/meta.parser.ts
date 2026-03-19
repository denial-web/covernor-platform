export function mapMetaEventToObjective(eventPayload: any): string | null {
  // 1. Handle Facebook Page Feed Comments
  if (eventPayload.value && eventPayload.field === 'feed') {
    const { item, verb, message, sender_name } = eventPayload.value;
    
    // We only care about new comments right now
    if (item === 'comment' && verb === 'add' && message) {
      const user = sender_name || 'a user';
      return `Analyze this new Facebook comment on our Page from ${user}: "${message}". Determine if it is a complaint, a question, or praise, and draft an appropriate, polite reply.`;
    }
  }

  // 2. Handle Direct Messages (Messenger)
  if (eventPayload.message && eventPayload.message.text) {
    const text = eventPayload.message.text;
    return `Analyze this new Facebook Messenger direct message: "${text}". Determine the user's intent, categorize the urgency, and draft an appropriate response.`;
  }
  
  return null;
}
