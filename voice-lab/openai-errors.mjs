// Provider messages may echo credentials or request text. Only expose our own
// explanations for known codes; never forward the raw error message.
export function openaiErrorMessage(error, { source = 'environment', status } = {}) {
  const credential = source === 'connection' ? 'the API key added in Connections' : 'the server’s OPENAI_API_KEY';
  switch (error?.code) {
    case 'account_deactivated':
      return `OpenAI reports that the API account associated with ${credential} is deactivated (account_deactivated). Replace this key in Connections with a key from your active OpenAI API account. Realtime uses this API key, separately from your Codex OAuth login.`;
    case 'invalid_api_key':
      return `OpenAI rejected ${credential} (invalid_api_key). Replace it in Connections. Signing into Codex does not replace the key used by this Realtime connection.`;
    case 'model_not_found':
      return 'OpenAI could not access the selected Realtime model (model_not_found). Check the model name in Fine-tune and this API project’s model access.';
    case 'insufficient_quota':
      return 'This OpenAI API project has insufficient quota (insufficient_quota). Check its API billing and usage limits; this Realtime connection does not use your Codex plan allowance.';
    case 'rate_limit_exceeded':
      return 'OpenAI’s API rate limit was reached (rate_limit_exceeded). Wait briefly, then try again.';
    case 'invalid_parameter':
    case 'unknown_parameter':
    case 'invalid_value':
    case 'missing_required_parameter': {
      const param = typeof error.param === 'string' && /^(session|response|audio|item_id|content_index|audio_end_ms)(\.[a-z_]+)*$/.test(error.param) ? `: ${error.param}` : '';
      return `OpenAI rejected a request setting (${error.code}${param}). This is a session configuration error, not evidence of the wrong Codex login.`;
    }
    default:
      if (status === 401) return `OpenAI could not authenticate ${credential} (HTTP 401). Replace the API key in Connections; the Codex OAuth login is separate.`;
      if (status === 403) return 'OpenAI denied this API project access (HTTP 403). Check the project’s permissions and model access.';
      return `OpenAI rejected the Realtime request${Number.isInteger(status) ? ` (HTTP ${status})` : ''}. Its response did not identify a recognized account or configuration error.`;
  }
}
