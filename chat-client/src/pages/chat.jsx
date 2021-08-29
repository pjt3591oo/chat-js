import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  Avatar,
  MessageSeparator,
  MessageGroup,
  ConversationHeader,
  StarButton,
  VoiceCallButton,
  VideoCallButton,
  InfoButton
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';

import { formatDate, formatTime } from '../utils/date';

import useMessage from '../hooks/useMessage';
import { DEFAULT_IMAGE } from '../utils/constant';


const Chat = (props) => {
  if (!props.match.params.chatId) props.history.replace('/');

  const chatId = parseInt(props.match.params.chatId);
  const { messages, sendMessage } = useMessage(chatId);
  const onSendHandler = (message) => {
    sendMessage(message);
  }

  function isMe(userId) {
    return parseInt(window.localStorage.getItem('userId')) === userId;
  }

  const headerHeight = 63;

  return (
    <>
      <ConversationHeader>
        <ConversationHeader.Back onClick={() => props.history.replace('/chats')}/>
        <Avatar src={DEFAULT_IMAGE}  />
        <ConversationHeader.Content userName={props.location.state.name} info={props.location.state.createdAt} />                                   
        <ConversationHeader.Actions>                                                                             
          {/* <StarButton title="Add to favourites" />
          <VoiceCallButton title="Start voice call" />
          <VideoCallButton title="Start video call" />
          <InfoButton title="Show info" /> */}
        </ConversationHeader.Actions>
      </ConversationHeader>
      <div style={{ position: "relative", height: window.innerHeight - headerHeight }}>
        <MainContainer>
          <ChatContainer>
            <MessageList>
              {messages.map((message, index) => (
                <>
                  {!index 
                    ? <MessageSeparator> {formatDate(message.createdAt)} </MessageSeparator>
                    : formatDate(message.createdAt) !== formatDate(messages[index - 1].createdAt)
                      ? (<MessageSeparator> {formatDate(message.createdAt)} </MessageSeparator>)
                      : (<></>)
                  }
                  
                  <MessageGroup 
                    direction={ isMe(message.user.id) ? "outgoing" : "incoming"}
                    sender={message.user.name}
                    sentTime={ message.createdAt}
                  >
                    {!isMe(message.user.id) && <Avatar src={message.user.profileImage} name="Emily" />}
                    <MessageGroup.Messages>
                      <Message model={{
                        message: message.msg
                      }} />
                    
                    </MessageGroup.Messages>
                    <MessageGroup.Footer>{formatTime(message.createdAt)}</MessageGroup.Footer>
                  </MessageGroup>
                </>
              ))}
            </MessageList>
            <MessageInput placeholder="Type message here" onSend={onSendHandler} />
          </ChatContainer>
        </MainContainer>
      </div>
    </>
  );
}

export default Chat;