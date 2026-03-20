function formatDate(date: Date): string {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMMM d, yyyy');
}

export { formatDate };
