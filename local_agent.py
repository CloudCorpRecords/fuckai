from smolagents import CodeAgent, DuckDuckGoSearchTool, LiteLLMModel
import warnings

# Suppress some verbose warnings from the libraries
warnings.filterwarnings("ignore")

print("Initializing the LLM Engine...")

# Connect to the local Ollama instance running Llama 3.1
model = LiteLLMModel(
    model_id="ollama_chat/llama3.1",
    api_base="http://localhost:11434",
    api_key="ollama" 
)

# Initialize the agent with the web search tool
print("Initializing the Agent and Tools...")
agent = CodeAgent(tools=[DuckDuckGoSearchTool()], model=model)

print("\n🚀 Local Llama 3.1 Agent is ready!")
print("Type 'exit' or 'quit' to stop.\n")

while True:
    user_input = input("You: ")
    if user_input.lower() in ["exit", "quit"]:
        break
    if not user_input.strip():
        continue
    
    print("\n[Agent is thinking...]")
    try:
        response = agent.run(user_input)
        print(f"\n🤖 Agent: {response}\n")
    except Exception as e:
        print(f"\n❌ An error occurred: {e}\n")
