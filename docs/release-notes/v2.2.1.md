# Upcoming release notes

## Ingestion

- **Imported claims and titles now read as complete text.** During ingestion the model is steered to write within each field's length limit, so a claim title or other short field no longer routinely runs over its budget and gets cut off mid-word. This works two ways at once: the structured-output schema asks for a slightly shorter value than the true limit (leaving headroom for the model's tendency to overshoot), and the field's instructions restate the budget in plain text. URLs and other exact-value fields are left at their full length so they are never clipped. As a final guard, any value that still comes back too long is trimmed to its real limit, exactly as before.
