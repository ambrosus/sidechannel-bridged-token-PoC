var http = require('http');
var url = require('url');
const fs = require("fs");
const Web3 = require('web3');
const Tx = require('ethereumjs-tx');

const MY_ADDRESS = '0xC14BbA1b6CC582BBB6B554a5c0821C619CFD42c4';
const MY_PRIVATE_KEY = Buffer.from('099e8dc1316d838865648e3df3698e7a2037b6c81f270cc075a415b4a8ca6270', 'hex');
const MAINNET_URL = "ws://localhost:8546";
const MAIN_TOKEN_SOURCE_FILE = "./bin/BridgedToken.json";
const SIDE_TOKEN_SOURCE_FILE = "./bin/SideChainToken.json";

var _web3_main = new Web3(new Web3.providers.WebsocketProvider(MAINNET_URL));
var _web3_side = new Web3(new Web3.providers.WebsocketProvider('ws://localhost:8548'));
var _token_main = '0xe329e3bc2f807ca50ff97aa8f0857750fd7446be';
var _token_side = '0xd3f12763cb93507e782c94d66648c76292461920';

let source = fs.readFileSync(MAIN_TOKEN_SOURCE_FILE);
let main_token_contract = JSON.parse(source);
source = fs.readFileSync(SIDE_TOKEN_SOURCE_FILE);
let side_token_contract = JSON.parse(source);

function displayPage(filename, res) {
    fs.readFile(filename, function(err, data) {
        if (err) {
          res.writeHead(404, {'Content-Type': 'text/html'});
          return res.end("404 Not Found");
        }
        res.writeHead(200, {});
        res.write(data);
        return res.end();
    });
}

function returnJson(json, res) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify(json));
    return res.end();
}

async function sendRawTx(provider, abiData, account, key, dest, val) {
    let nonce = await provider.eth.getTransactionCount(account);
    var rawTx = {
        nonce: nonce,
        from: account,
        to: dest,
        data: abiData,
        value: val,
        gasPrice: '0x09184e72a000',
        gasLimit: '0x5AA710',
      };
    const tx = new Tx(rawTx);
    tx.sign(key);
    return await provider.eth.sendSignedTransaction('0x' + tx.serialize().toString('hex'))
}

function selectNetwork(net, err) {
    var selectedProvider;
    var selectedToken;
    var selectedContract;
    switch (net) {
        case "main":
            selectedProvider = _web3_main;
            selectedToken = _token_main;
            selectedContract = main_token_contract;
            break;
        case "side":
            selectedProvider = _web3_side;
            selectedToken = _token_side;
            selectedContract = side_token_contract;
            break;
        default:
            err();
            break;
    }
    return { provider: selectedProvider, token: selectedToken, contract: selectedContract };
}

function getAccount(req, res) {
    var account = {
        address: MY_ADDRESS
    }
    return returnJson(account, res);
}

async function getTokenBalance(web3_provider, contract, token, account, key) {
    let token_dest = web3_provider.eth.Contract(contract.abi, token);
    let balance = await token_dest.methods.balanceOf(account).call({from: account});
    return balance;
}

async function getBalance(req, res) {
    try {
        var balance = {};
        var params = selectNetwork(req.query.net, () => {
            balance.err = "Invalid network specified";
        });

        if (params.provider)
        {
            balance.net = req.query.net;
            balance.amount = await getTokenBalance(params.provider, params.contract, params.token, MY_ADDRESS, MY_PRIVATE_KEY);
        }
        return returnJson(balance, res);
    } catch (error) {
        console.log(error);
        var balance = {
            err: error.toString()
        };
        return returnJson(balance, res)
    }
}

async function transferTokens(req, res) {
    try {
        await sendRawTx(_web3_side, "0x0", MY_ADDRESS, MY_PRIVATE_KEY, req.query.to, req.query.amount);
        return returnJson({}, res);
    } catch (error) {
        console.log(error);
        var balance = {
            err: error.toString()
        };
        return returnJson(balance, res)
    }
}

async function convertTokens(req, res) {
    try {
        var conversion = {};
        var params = selectNetwork(req.query.net, () => {
            conversion.err = "Invalid network specified";
            console.log(req.query.net);
        });
        if (params.provider) {
            let token_dest = params.provider.eth.Contract(params.contract.abi, params.token);
            let abiData = token_dest.methods.lock(req.query.amount).encodeABI();
            if (req.query.net == "side"){
                await sendRawTx(params.provider, abiData, MY_ADDRESS, MY_PRIVATE_KEY, params.token, req.query.amount);
            } else {
                await sendRawTx(params.provider, abiData, MY_ADDRESS, MY_PRIVATE_KEY, params.token);
            }
        }
        return returnJson(conversion, res);
    } catch (error) {
        console.log(error);
        var balance = {
            err: error.toString()
        };
        return returnJson(balance, res)
    }
}

function selectAction(req, res) {
    switch (req.pathname) {
        case "":
        case "/":
            return displayPage("./Wallet.html", res);
        case "/get_account":
            return getAccount(req, res);
        case "/get_balance":
            return getBalance(req, res);
        case "/transfer":
            return transferTokens(req, res);
        case "/convert":
            return convertTokens(req, res);
        default:
            return displayPage("." + req.pathname, res)
    }
}

console.log("Starting server...");
http.createServer(function (req, res) {
    var q = url.parse(req.url, true);
    return selectAction(q, res);
}).listen(8081);