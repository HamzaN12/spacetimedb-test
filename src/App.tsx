import React, { useEffect, useRef, useState } from "react";
import "./App.css";

export type MessageType = {
	name: string;
	message: string;
	time: Date;
};

import {
	SpacetimeDBClient,
	Address,
	Identity,
} from "@clockworklabs/spacetimedb-sdk";

import Message from "./module_bindings/message";
import User from "./module_bindings/user";
import SendMessageReducer from "./module_bindings/send_message_reducer";
import SetNameReducer from "./module_bindings/set_name_reducer";

SpacetimeDBClient.registerReducers(SendMessageReducer, SetNameReducer);
SpacetimeDBClient.registerTables(Message, User);

let token = localStorage.getItem("auth_token") || undefined;
var spacetimeDBClient = new SpacetimeDBClient(
	"wss://testnet.spacetimedb.com",
	"sybomtestchat",
	token
);

function App() {
	let local_identity = useRef<Identity | undefined>(undefined);
	let initialized = useRef<boolean>(false);
	const client = useRef<SpacetimeDBClient>(spacetimeDBClient);

	function userNameOrIdentity(user: User): string {
		console.log(`Name: ${user.name} `);
		if (user.name !== null) {
			return user.name || "";
		} else {
			var identityStr = new Identity(
				user.identity.toUint8Array()
			).toHexString();
			console.log(`Name: ${identityStr} `);
			return new Identity(user.identity.toUint8Array())
				.toHexString()
				.substring(0, 8);
		}
	}

	function setAllMessagesInOrder() {
		let messages = Array.from(Message.all());
		messages.sort((a, b) => (a.sent > b.sent ? 1 : a.sent < b.sent ? -1 : 0));

		let messagesType: MessageType[] = messages.map((message) => {
			let sender_identity = User.filterByIdentity(message.sender);
			let display_name = sender_identity
				? userNameOrIdentity(sender_identity)
				: "unknown";

			return {
				name: display_name,
				message: message.text,
				time: new Date(Number(message.sent) / 1000),
			};
		});

		setMessages(messagesType);
	}

	const [newName, setNewName] = useState("");
	const [settingName, setSettingName] = useState(false);
	const [name, setName] = useState("");
	const [systemMessage, setSystemMessage] = useState<String[]>([]);
	const [messages, setMessages] = useState<MessageType[]>([]);

	const [newMessage, setNewMessage] = useState("");

	const textareaRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!textareaRef.current) {
			return;
		}

		textareaRef.current.scrollTo(0, 10000000000);
	}, [messages, textareaRef]);

	useEffect(() => {
		if (!initialized.current) {
			client.current.onConnect((token, identity, address) => {
				console.log("Connected to SpacetimeDB");

				local_identity.current = identity;

				localStorage.setItem("auth_token", token);

				client.current.subscribe([
					"SELECT * FROM User",
					"SELECT * FROM Message",
				]);
			});

			client.current.on("initialStateSync", () => {
				setAllMessagesInOrder();
				var user = User.filterByIdentity(local_identity?.current!);
				setName(userNameOrIdentity(user!));
			});

			Message.onInsert((message, reducerEvent) => {
				if (reducerEvent !== undefined) {
					setAllMessagesInOrder();
				}
			});

			// Helper function to append a line to the systemMessage state
			function appendToSystemMessage(line: String) {
				systemMessage.push(line);
				if (systemMessage.length > 5) {
					systemMessage.splice(0, 1);
				}

				setSystemMessage([...systemMessage]);
			}

			User.onInsert((user, reducerEvent) => {
				if (user.online) {
					appendToSystemMessage(`${userNameOrIdentity(user)} has connected.`);
				}
			});

			User.onUpdate((oldUser, user, reducerEvent) => {
				if (oldUser.online === false && user.online === true) {
					appendToSystemMessage(`${userNameOrIdentity(user)} has connected.`);
				} else if (oldUser.online === true && user.online === false) {
					appendToSystemMessage(
						`${userNameOrIdentity(user)} has disconnected.`
					);
				}

				if (user.name !== oldUser.name) {
					appendToSystemMessage(
						`User ${userNameOrIdentity(
							oldUser
						)} renamed to ${userNameOrIdentity(user)}.`
					);
				}
			});

			SetNameReducer.on((reducerEvent, newName) => {
				if (
					local_identity.current &&
					reducerEvent.callerIdentity.isEqual(local_identity.current)
				) {
					if (reducerEvent.status === "failed") {
						appendToSystemMessage(
							`Error setting name: ${reducerEvent.message} `
						);
					} else if (reducerEvent.status === "committed") {
						setName(newName);
					}
				}
			});

			SendMessageReducer.on((reducerEvent, newMessage) => {
				if (
					local_identity.current &&
					reducerEvent.callerIdentity.isEqual(local_identity.current)
				) {
					if (reducerEvent.status === "failed") {
						appendToSystemMessage(
							`Error sending message: ${reducerEvent.message} `
						);
					}
				}
			});

			client.current.connect();
			initialized.current = true;
		}
	}, []);

	const onSubmitNewName = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setSettingName(false);
		SetNameReducer.call(newName);
	};

	const onMessageSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		SendMessageReducer.call(newMessage);
		setNewMessage("");
	};

	return (
		<main className="w-screen min-h-screen">
			<div className="container mx-auto py-12">
				<div className="flex flex-col">
					<h1>Profile</h1>
					{!settingName ? (
						<>
							<p>Username: {name}</p>
							<button
								className="py-2 px-4 rounded-md bg-slate-700 w-fit"
								onClick={() => {
									setSettingName(true);
									setNewName(name);
								}}
							>
								Edit Name
							</button>
						</>
					) : (
						<form onSubmit={onSubmitNewName} className="space-x-2">
							<input
								type="text"
								className="p-1"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
							/>
							<button type="submit">Submit</button>
						</form>
					)}
				</div>
				<div className="my-6 bg-zinc-800 p-4 rounded-md">
					<h1>Messages</h1>
					{messages.length < 1 && <p>No messages</p>}
					<div ref={textareaRef} className="overflow-y-auto flex flex-col h-96">
						{messages.map((message, key) => (
							<div key={key}>
								<p>
									<span>[{message.time.toLocaleTimeString()}] </span>
									<b>{message.name}: </b>
									<span>{message.message}</span>
								</p>
							</div>
						))}
					</div>
				</div>
				<div className="system" style={{ whiteSpace: "pre-wrap" }}>
					<h1>System</h1>
					<div>
						<p>{systemMessage.join("\n")}</p>
					</div>
				</div>
				<div className="">
					<form
						onSubmit={onMessageSubmit}
						style={{
							display: "flex",
							flexDirection: "column",
							width: "50%",
							margin: "0 auto",
						}}
						className="gap-2"
					>
						<h3>New Message</h3>
						<textarea
							className="p-1"
							value={newMessage}
							onChange={(e) => setNewMessage(e.target.value)}
						></textarea>
						<button
							type="submit"
							className="bg-black w-fit px-4 py-2 rounded-md"
						>
							Send
						</button>
					</form>
				</div>
			</div>
		</main>
	);
}

export default App;
