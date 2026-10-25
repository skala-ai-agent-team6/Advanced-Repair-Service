"""지정 접수 한 건만 실제 부품 도구 요청을 강제하는 E2E 검증 워커."""
import asyncio, logging, os, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from worker import tools, harness, main, config as C
from worker.observability import configure_logging
original=tools.parts_agent_llm

def model(specs, *, tool_choice=None):
    llm=original(specs, tool_choice=tool_choice)
    if tool_choice == "none":
        return llm
    budget=harness.current.get()
    if budget and str(budget.context.get('case_id'))==os.environ['BOUNDARY_REPAIR_ID']:
        return llm.bind(tool_choice={'type':'function','function':{'name':'get_part_availability'}},parallel_tool_calls=False)
    return llm

tools.parts_agent_llm=model
configure_logging(log_file=str(C.ROOT/'.local/logs/agent.jsonl'))
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(message)s')
logging.getLogger('aiokafka').setLevel(logging.WARNING)
asyncio.run(main.run())
