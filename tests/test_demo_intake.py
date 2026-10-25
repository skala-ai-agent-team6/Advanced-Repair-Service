from urllib.error import HTTPError
from unittest.mock import Mock
import pytest
from integration.demo import ensure_diagnosis


def test_existing_diagnosis_is_not_started_again():
    c = Mock()
    c.call.return_value = {'status': 'RUNNING'}
    assert ensure_diagnosis(c, 6)['status'] == 'RUNNING'
    c.call.assert_called_once_with('GET', '/api/repairs/6/diagnosis')


def responses(verdict='PASS'):
    return [HTTPError('local',404,'not started',{},None),
            {'attachments':[{'id':'9','request_id':None,'use_status':'AVAILABLE'}]},
            {'enabled':True,'required':True,'latest':{'id':'1','status':'COMPLETED','verdict':verdict}}]


def test_selected_attachment_sent_before_polling():
    c=Mock(); c.call.side_effect=responses()+[{'taskId':'3','status':'QUEUED'}]
    assert ensure_diagnosis(c,6)['taskId']=='3'
    assert c.call.call_args.args == ('POST','/api/repairs/6/diagnosis',{'attachmentIds':[9]})


def test_warning_requires_explicit_option():
    c=Mock(); c.call.side_effect=responses('WARNING')
    with pytest.raises(RuntimeError,match='품질 경고'):
        ensure_diagnosis(c,6)
    assert not any(call.args[0]=='POST' for call in c.call.call_args_list)


def test_warning_acknowledged_then_diagnosis_started():
    c=Mock(); c.call.side_effect=responses('WARNING')+[{}, {'taskId':'3'}]
    ensure_diagnosis(c,6,accept_warnings=True)
    assert c.call.call_args_list[-2].args == ('POST','/api/attachments/9/quality/acknowledgment',{'resultId':1})
    assert c.call.call_args_list[-1].args[1] == '/api/repairs/6/diagnosis'
