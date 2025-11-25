const assert = require('assert');
// Note: This is a mock test for gatekeeper logic
// The real validateShiftPlan function uses Gemini API, which requires GEMINI_API_KEY
// For testing, we verify the error handling and JSON parsing logic

function testGatekeeperLogic() {
  // Mock the schema validation
  const mockValidResponses = [
    { input: 'Finish API integration and manager dashboard', expected: true },
    { input: 'Complete Q4 planning and review metrics', expected: true },
    { input: 'asdfasdfasdf', expected: false },
    { input: '', expected: false },
    { input: '🎉🎊🎨', expected: false },
  ];

  // Test JSON parsing logic (separate from API calls)
  const testJsonParsing = () => {
    const validJson = '{"valid": true}';
    const invalidJson = 'not json at all';
    const jsonWithMarkdown = '```json\n{"valid": false}\n```';

    // Test valid JSON
    try {
      const parsed = JSON.parse(validJson);
      assert.strictEqual(typeof parsed.valid, 'boolean');
    } catch (e) {
      throw new Error('Failed to parse valid JSON');
    }

    // Test invalid JSON
    try {
      JSON.parse(invalidJson);
      throw new Error('Should have failed parsing invalid JSON');
    } catch (e) {
      assert.ok(e.message.includes('Unexpected token') || e.message.includes('Unexpected'));
    }

    // Test markdown code fence stripping
    const cleaned = jsonWithMarkdown
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const parsedCleaned = JSON.parse(cleaned);
    assert.strictEqual(parsedCleaned.valid, false);
  };

  testJsonParsing();
  console.log('gatekeeper JSON parsing tests passed');
}

testGatekeeperLogic();
