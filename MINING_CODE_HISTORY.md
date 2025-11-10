# Mining Code History

This document shows the evolution of mining code in this repository based on git history.

## Timeline of Mining Software

1. **Early versions**: Used `ethminer` (Ethereum miner)
2. **May 2021**: Switched to `lolMiner` 
3. **Oct 2021 - May 2022**: Used `ethminer 0.19.0` 
4. **May 2022**: Switched to `etcminer` for Ethereum Classic
5. **June 2023**: Switched to external `runner` binary (current)

## Found Mining Code

### 1. ethminer Setup (Commit: e05e425ad95a5b3b61d0f6f914a64e87a8da2848)

**File**: `src/user-data.txt`

```bash
#!/bin/bash -x
cd /tmp
AZID=$(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone-id | cut -d- -f1)
INSTTYPE=$(curl -s http://169.254.169.254/latest/meta-data/instance-type)
wget -O ethminer.tar.gz "https://ethminer-cuda.s3.amazonaws.com/0.19.0/${EthminerTarGz}?az=${!AZID}&type=${!INSTTYPE}"
tar xvfz ethminer.tar.gz
cd bin
case ${!AZID:0:1} in
  u) PREFERRED_SERVER="us1";;
  e) PREFERRED_SERVER="eu1";;
  a) PREFERRED_SERVER="asia1";;
  *) PREFERRED_SERVER="us2";;
esac
cat > runner.sh << __EOF__
#!/bin/bash -x
while (true); do
  ./ethminer ${EthminerArgs} \
    -P stratums://${EthWallet}.${AWS::Region}@${!PREFERRED_SERVER}.ethermine.org:5555 \
    -P stratums://${EthWallet}.${AWS::Region}@us1.ethermine.org:5555 \
    -P stratums://${EthWallet}.${AWS::Region}@us2.ethermine.org:5555 \
    -P stratums://${EthWallet}.${AWS::Region}@eu1.ethermine.org:5555 \
    -P stratums://${EthWallet}.${AWS::Region}@asia1.ethermine.org:5555 \
  >> /tmp/ethminer.log 2>&1
  sleep 1
done
__EOF__
chmod +x runner.sh
nohup ./runner.sh &
```

**Features**:
- Downloaded ethminer 0.19.0 from S3
- Used multiple ethermine.org pool servers for redundancy
- Region-based server selection
- Continuous mining loop with automatic restart

### 2. etcminer Setup (Commit: fbfbd923839d7da285253b34198f7c6fe7e2d689)

**File**: `src/user-data-etc.txt`

```bash
#!/bin/bash -x
cd /tmp
AZID=$(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone-id | cut -d- -f1)
INSTTYPE=$(curl -s http://169.254.169.254/latest/meta-data/instance-type)
wget -O etcminer.tar.gz https://etcminer-release.s3.amazonaws.com/0.20.0/${EtcminerTarGz}
tar xvfz etcminer.tar.gz
cd etcminer
case ${!AZID:0:1} in
  e) PREFERRED_SERVER="etc";;
  u) PREFERRED_SERVER="us-etc";;
  a) PREFERRED_SERVER="asia-etc";;
  *) PREFERRED_SERVER="etc";;
esac
cat > runner.sh << __EOF__
#!/bin/bash -x
while (true); do
  ./etcminer ${EtcminerArgs} --exit \
    -P stratums://${WalletAddress}.${AWS::Region}@${!PREFERRED_SERVER}.2miners.com:11010 \
    -P stratums://${WalletAddress}.${AWS::Region}@etc.2miners.com:11010 \
    -P stratums://${WalletAddress}.${AWS::Region}@eu-etc.2miners.com:11010 \
    -P stratums://${WalletAddress}.${AWS::Region}@asia-etc.2miners.com:11010 \
  >> /tmp/etcminer.log 2>&1
  sleep 1
done
__EOF__
chmod +x runner.sh
nohup ./runner.sh &
```

**Features**:
- Downloaded etcminer 0.20.0 from S3
- Used 2miners.com pool (switched from ethermine.org)
- Region-based server selection
- Support for both CUDA (-U) and OpenCL (-G) modes

### 3. lolMiner Setup (Commit: 9cb87074e52644e106b21572d3775a9877e5c7e1)

**Inline in template** (before externalization):

```bash
#!/bin/bash -x
cd /tmp
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id | cut -b-8)
AZ_ID=$(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone-id)
wget -O lolminer.tar.gz https://github.com/Lolliedieb/lolMiner-releases/releases/download/1.28/lolMiner_v1.28a_Lin64.tar.gz
tar xvfz lolminer.tar.gz
cd 1.28a
cat > runner.sh << __EOF__
#!/bin/bash -x
SERVERS=(us1 us2 eu1 asia1)
while (true); do
  ./lolMiner --algo ETHASH --pool us1.ethermine.org:5555 --tls on --user ${EthWallet}.${!INSTANCE_ID}-${!AZ_ID}
  ./lolMiner --algo ETHASH --pool us2.ethermine.org:5555 --tls on --user ${EthWallet}.${!INSTANCE_ID}-${!AZ_ID}
done
__EOF__
chmod +x runner.sh
nohup ./runner.sh &
```

**Features**:
- Downloaded lolMiner from GitHub releases
- Used TLS encryption
- Multiple pool servers

## Current Implementation (June 2023+)

**File**: `src/user-data-runner.txt`

```bash
#!/bin/bash -x
shutdown -P +$((14400 + $RANDOM % 7200))  # Refresh the fleet every 10-15 days
cd /tmp
wget -O /tmp/runner https://s3.us-west-2.amazonaws.com/cnl4uehyq6/pyrite/runner/runner-x86_64-v1
chmod +x /tmp/runner
cat > runner.sh << __EOF__
#!/bin/bash -x
for X in \$(seq 10); do
  ./runner --coin ${CoinName} --wallet ${WalletAddress}
  sleep 10
done > /tmp/runner.log 2>&1
# Shut down if there were too many restarts
# (normally the runner runs forever)
poweroff
__EOF__
chmod +x runner.sh
nohup ./runner.sh &
```

**Features**:
- Downloads a pre-compiled `runner` binary from S3
- Supports multiple coins (RVN, ERG, KAS, ETC)
- Automatic fleet refresh (10-15 days)
- Simpler interface with coin and wallet parameters

## Key Changes Over Time

1. **Mining Software**:
   - ethminer → lolMiner → ethminer → etcminer → runner (external binary)

2. **Mining Pools**:
   - ethermine.org → 2miners.com

3. **Supported Coins**:
   - Ethereum (ETH) → Ethereum Classic (ETC) → Multiple altcoins (RVN, ERG, KAS, ETC)

4. **Code Location**:
   - Inline in CloudFormation templates → External user-data files → External binary

## Git Commits Reference

- `9cb87074e52644e106b21572d3775a9877e5c7e1` - Switch from ethminer to lolMiner
- `47bcb3f03d00577a2e64d492a4adf3a5d59a250f` - Use ethminer 0.19.0-git + CUDA 10
- `162d7159c9f662a3148356f339e9be14e4cc0013` - Use ethminer 0.19.0 (dev from git)
- `e05e425ad95a5b3b61d0f6f914a64e87a8da2848` - Fix ethminer urls
- `624096a986e448557eb49cb36946bb5258840f2f` - Externalise UserData
- `fbfbd923839d7da285253b34198f7c6fe7e2d689` - Switch to 2miners because etc.ethermine.org is going down
- `718f3a733704fee4808ad01faa868975aade92eb` - Use runner instead of etcminer

## Notes

- The actual mining binaries (ethminer, etcminer, lolMiner, runner) were never stored in this repository
- Only the setup/configuration scripts are in git history
- The runner binary is currently hosted externally at: `s3.us-west-2.amazonaws.com/cnl4uehyq6/pyrite/runner/runner-x86_64-v1`
- Previous miners were downloaded from:
  - ethminer: `ethminer-cuda.s3.amazonaws.com`
  - etcminer: `etcminer-release.s3.amazonaws.com`
  - lolMiner: GitHub releases
